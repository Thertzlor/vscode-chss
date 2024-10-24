import {type TokenData} from './rangesByName';
import {Range ,languages, type TextDocument, RelativePattern, type Uri} from 'vscode';
import color from 'tinycolor2';

type MatchType = 'endsWith'|'startsWith'|'includes'|'match';
interface ParsedSelector {type:string, specificity:number, name:string, modifiers:string[], scopes?:string[],match?:MatchType,regexp?:RegExp}
interface HssRule {selector:ParsedSelector[], style:Record<string,string>, scope?:string, colorActions?:Map<string,[ColorAction,string]>}
interface ProtoHssMatch {range:Range, style:Record<string,string>, specificity:number,colorActions?:Map<string,[ColorAction,string]>}
type HssMatch = Omit<ProtoHssMatch,'colorActions'>;
const colorMods = ['lighten','brighten','darken','desaturate','saturate','greyscale','spin','random'] as const;
type ColorAction = typeof colorMods[number];

export class HssParser{
  constructor(
    private readonly baseUri?:Uri,
    private readonly colorMap= new Map<string,string>()
  ){}

  private parseSelector(selector:string):ParsedSelector{
    const invalid = {specificity:0, name:'', type:'',modifiers:[]};
    if (selector === '*') return {specificity:1, name:'', type:'*',modifiers:[]};
    if (/^\w+$/.test(selector)) return {specificity:50, name:selector, type:'*',modifiers:[]}; //simple variable: name
    if (/^\w+$/.test(selector.slice(1))){
      const sliced = selector.charAt(0);
      switch (sliced) {
      case '#': return {specificity:100, name:selector.slice(1), type:'variable',modifiers:[]}; //function: #name
      case '.': return {specificity:100, name:selector.slice(1), type:'function',modifiers:[]}; //class: .name
      default: return invalid;
      }
    }
    if (selector.startsWith('<') && selector.endsWith('>')){
      const [operator,val,manualType] = selector.slice(1,-1).split('=').map(s => s.trim());
      const ops:Record<string,MatchType|undefined> = {'^':'startsWith','*':'includes',$:'endsWith'};
      const mType:MatchType = ops[operator] ?? 'match';
      const matchSpecs = {match:40,startsWith:30,endsWith:30,includes:20};
      const value = val || operator;
      if (mType === 'match' && !value.includes('*') && !/^"\/.+\/i?"$/.test(value)) return invalid;
      const insense = value.slice(0,-1).endsWith('/i');
      const regexp=mType === 'match'?new RegExp(value.startsWith('"') && value.endsWith('"')?value.slice(2,insense?-3:-2):value.replace('*','.*'),insense && value.startsWith('"')?'i':undefined):undefined;
      return {specificity:matchSpecs[mType], name:value, type:manualType||'*',modifiers:[],regexp,match:mType};
    }
    if (selector.startsWith('[') && selector.endsWith(']')) return {specificity:2, name:'', type:selector.slice(1,-1),modifiers:[]}; // general type: [variable]
    if (selector.startsWith('[')){ // extended type with one or more modifiers: [variable]:readonly
      const modifiers = selector.split(':');
      const sel = modifiers.shift() ?? '';
      if (!modifiers.length || !sel.endsWith(']')) return invalid;
      return {specificity:10+(modifiers.length*10), name:'', type:sel.slice(1,-1),modifiers};
    }
    if (selector.includes('[') && selector.includes(']')){ //compound: name[variable]:readonly
      if (!/\w/.test(selector.charAt(0))) return invalid;//eslint-disable-next-line unicorn/better-regex
      const splitUp = selector.split(/\[|\]/gm);
      const name = splitUp.shift()!;
      const type = splitUp.shift();
      const mods = splitUp.shift();
      if (!type) return invalid;
      if (!mods) return {specificity:11, name, type,modifiers:[]};
      const splitMods = mods.split(':');
      return {specificity:11+(10*splitMods.length), name, type,modifiers:splitMods};
    }
    if (selector.includes('[') || selector.includes(']')) return invalid;
    const splitMods = selector.split(':');
    const ident = splitMods.shift();
    if (!ident) return invalid;
    const {specificity,name,type} = this.parseSelector(ident);
    if (specificity === 0) return invalid;
    return {specificity:specificity+(10*splitMods.length), name, type,modifiers:splitMods};
  }

  public parseHss(str:string){
    const res = [] as HssRule[];
    let skipNext = false;
    let currentScope:string|undefined;
    for (const [i,v] of str.replaceAll(/\/\/.*/g,'').replaceAll(/{\s*}/gm,'{empty}').split(/[{}]/gm).map(s => s.trim()).entries()) {
      const selector = (i + (currentScope?1:0)) % 2 === 0;
      if (currentScope && !v){currentScope = undefined; continue;}
      if (skipNext){skipNext = false; continue;}
      if (selector && !v) {skipNext = true; continue;}
      if (selector){
        if (v.startsWith('scope(')){
          currentScope = v.match(/.*\((.*)\)$/)?.[1].trim() || '???';
          continue;
        }
        const selectors = v.split(',').map(s => s.trim()).filter(s => s).map(s => this.parseSelector(s)).filter(({specificity}) => specificity !== 0);
        if (!selectors.length){skipNext = true; continue;}
        const protoRule:HssRule = {selector:selectors,style:{}};
        if (currentScope)protoRule.scope = currentScope;
        res.push(protoRule);
      }
      else {
        if (!v || v === 'empty'){res.pop(); continue;}
        const rules = v.split(';').map(s => s.trim()).filter(s => s);
        if (!rules.length){res.pop(); continue;}
        const ruleObj = {} as Record<string,string>;
        const cMap= new Map<string,[ColorAction,string]>();
        for (const r of rules) {
          const [name,value] = r.split(':').map(s => s.trim());
          if (name && value) {
            if (colorMods.some(m => value.startsWith(`${m}(`))){
              const [mode,arg] = value.split(/\(|\)/gm).map(s => s.trim());
              cMap.set(name,[mode as ColorAction,arg]);
            }
            else ruleObj[name.replaceAll(/-(\w)/gm,a => a[1].toUpperCase())]=value;}
        }
        const cuRule = res.at(-1);
        if (cuRule){
          cuRule.style = ruleObj;
          if (cMap.size) cuRule.colorActions=cMap;
        }
      }
    }
    return res;
  }

  private matchName(name:string,type:MatchType,val:string,reg?:RegExp){
    if (reg) return reg.test(name);
    return !!name[type](val);
  }

  public processHss(rangeObject:Record<string, Set<TokenData>>,rules:HssRule[],doc?:TextDocument):HssMatch[]{
    const matched:ProtoHssMatch[] = [];
    const combined = new Map<string,HssMatch>();
    for (const {selector,style,scope,colorActions} of rules) {
      if (scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue;
      for (const parsed of selector) {
        const targetType = parsed.type;
        if (!(targetType in rangeObject) && targetType !== '*') continue;
        for (const {name,range,modifiers} of targetType === '*'?Object.keys(rangeObject).flatMap(k => [...rangeObject[k]]):rangeObject[targetType]) {
          // console.log({parsed,matched : parsed.match && this.matchName(name,parsed.match, parsed.name,parsed.regexp)})
          if ((!parsed.name || parsed.name === name || (parsed.match && this.matchName(name,parsed.match, parsed.name,parsed.regexp))) && !parsed.modifiers.some(m => !modifiers.includes(m))) matched.push({range,style,colorActions,specificity:parsed.specificity});
        }
      }
    }

    for (const current of matched){
      const {range, style,colorActions} =current;
      const rangeIdent = [range.start.line,range.start.character,range.end.line,range.end.character].join('|');
      if (!combined.has(rangeIdent)){
        combined.set(rangeIdent, current);
      } else {
        const old = combined.get(rangeIdent)!;
        const [sA, sB] = [current,old].map(s => s.specificity);
        if ((sA>=sB) && colorActions){
          for (const [name,[action,args]] of colorActions.entries()) {
            if (action === 'random') {
              style[name] = color.random().toHex8String();
              continue;
            }
            if (!(name in old.style)) continue;
            const colorIdent = [old.style[name],action,args].join('-');
            if (this.colorMap.has(colorIdent)) {
              style[name] = this.colorMap.get(colorIdent)!;
              continue;
            }
            const oldCol = color(old.style[name]);
            if (!oldCol.isValid()) continue;
            const newCol = oldCol[action](args?parseInt(args,10):undefined as never);
            if (newCol.isValid()) {
              const hexa =newCol.toHex8String();
              this.colorMap.set(colorIdent, hexa);
              style[name] = hexa;
            }
          }
        }
        combined.set(rangeIdent,{range, style:sA<sB?{...style, ...old.style}:{...old.style, ...style} , specificity:Math.max(sA,sB)});
      }
    }
    return [...combined.values()];
  }

}