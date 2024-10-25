import {Range ,languages, RelativePattern} from 'vscode';
import type {TextDocument, Uri} from 'vscode';
import type {TokenData} from './rangesByName';
import color from 'tinycolor2';

type MatchType = 'endsWith'|'startsWith'|'includes'|'match';
interface ParsedSelector {type:string, specificity:number, name:string, modifiers:string[], scopes?:string[],match?:MatchType,regexp?:RegExp,pseudo?:Pseudo}
interface ChssRule {selector:ParsedSelector[], style:Record<string,string>, scope?:string, colorActions?:Map<string,[ColorAction,string]>}
interface ProtoChssMatch {range:Range, style:Record<string,string>,pseudo?:'before'|'after', specificity:number,colorActions?:Map<string,[ColorAction,string]>}
type ChssMatch = Omit<ProtoChssMatch,'colorActions'>;
const colorMods = ['lighten','brighten','darken','desaturate','saturate','greyscale','spin','random'] as const;
type ColorAction = typeof colorMods[number];
type Pseudo = 'before'|'after';

export class ChssParser{
  constructor(
    private readonly baseUri?:Uri,
    private readonly colorMap= new Map<string,string>()
  ){}

  private parseSelector(rawSelector:string):ParsedSelector{
    const invalid = {specificity:0, name:'', type:'',modifiers:[]};
    const pseudo = (['before','after'] as const).find(b => rawSelector.includes(`::${b}`));
    const selector = pseudo?rawSelector.replaceAll(`::${pseudo}`, ''):rawSelector;
    if (selector === '*') return {specificity:1, name:'', type:'*',modifiers:[],pseudo};
    if (/^\w+$/.test(selector)) return {specificity:50, name:selector, type:'*',modifiers:[],pseudo}; // name selector for all types: name
    if (/^\w+$/.test(selector.slice(1)) && !selector.startsWith(':')){
      const sliced = selector.charAt(0);
      switch (sliced) {
      case '#': return {specificity:100, name:selector.slice(1), type:'variable',modifiers:[],pseudo}; //variable: #name
      case '.': return {specificity:100, name:selector.slice(1), type:'function',modifiers:[],pseudo}; //function: .name
      default: return invalid;
      }
    }
    if (selector.startsWith('<') && selector.endsWith('>')){ // Advanced match: <wildc*rd> | <^=textmatch> | <"/RegEx/"> | <^=match=type>
      const [operator,val,rawType] = selector.slice(1,-1).split('=').map(s => s.trim());
      const ops:Record<string,MatchType|undefined> = {'^':'startsWith','*':'includes',$:'endsWith'};
      const mType:MatchType = ops[operator] ?? 'match';
      const matchSpecs = {match:40,startsWith:30,endsWith:30,includes:20};
      const value = val || operator;
      if (mType === 'match' && !value.includes('*') && !/^"\/.+\/i?"$/.test(value)) return invalid;
      const insense = value.slice(0,-1).endsWith('/i');
      const regexp=mType === 'match'?new RegExp(value.startsWith('"') && value.endsWith('"')?value.slice(2,insense?-3:-2):`^${value.replace('*','.*')}$`,insense && value.startsWith('"')?'i':undefined):undefined;
      let manualType = rawType;
      if (rawType) manualType = rawType.includes(':') ? ((c = rawType.indexOf(':')) => `[${rawType.slice(0,c)}]${rawType.slice(c)}`)() : `[${rawType}]`;
      const {type='*',modifiers=[]} = rawType? this.parseSelector(manualType):{};
      return {specificity:matchSpecs[mType], name:value, type,modifiers,regexp,match:mType,pseudo};
    }
    if (selector.startsWith('[') && selector.endsWith(']')) return {specificity:2, name:'', type:selector.slice(1,-1),modifiers:[],pseudo}; // general type: [variable]
    if (selector.startsWith('[')){ // extended type with one or more modifiers: [variable]:readonly
      const [sel='',...modifiers] = selector.split(':');
      if (!modifiers.length || !sel.endsWith(']')) return invalid;
      return {specificity:10+(modifiers.length*10), name:'', type:sel.slice(1,-1),modifiers,pseudo};
    }
    if (selector.includes('[') && selector.includes(']')){ //compound: name[variable]:readonly
      if (!/\w/.test(selector.charAt(0))) return invalid;//eslint-disable-next-line unicorn/better-regex
      const [name,type,mods] = selector.split(/\[|\]/gm);
      if (!type) return invalid;
      if (!mods) return {specificity:11, name, type,modifiers:[]};
      const splitMods = mods.split(':');
      return {specificity:11+(10*splitMods.length), name, type,modifiers:splitMods,pseudo};
    }
    if (selector.includes('[') || selector.includes(']')) return invalid;
    // name with modifiers: variable:modifier
    const [ident, ...splitMods] = selector.split(':');
    if (!ident) return splitMods.length? {specificity:2*splitMods.length, name:'', type:'*',modifiers:splitMods,pseudo}:invalid;
    const {specificity,name,type} = this.parseSelector(ident);
    if (specificity === 0) return invalid;
    return {specificity:specificity+(10*splitMods.length), name, type,modifiers:splitMods,pseudo};
  }

  /**
   * A gnarly minimal parser for pseudo css.
   * @param source -The source code of the file
   */
  public parseChss(source:string){
    const res = [] as ChssRule[];
    let skipNext = false;
    let currentScope:string|undefined;
    for (const [i,v] of source.replaceAll(/\/\/.*/g,'').replaceAll(/{\s*}/gm,'{empty}').split(/[{}]/gm).map(s => s.trim()).entries()) {
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
        const protoRule:ChssRule = {selector:selectors,style:{}};
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
          const [_,name,value] = [...r.match(/^([^:]+):(.*)$/) ?? [void 0]].map(s => s?.trim());
          if (name && value) {
            const unquoted = value.startsWith('"') && value.endsWith('"')?value.slice(1,-1):value;
            if (colorMods.some(m => value.startsWith(`${m}(`))){
              const [mode,arg] = value.split(/\(|\)/gm).map(s => s.trim());
              cMap.set(name,[mode as ColorAction,arg]);
            }
            else ruleObj[name.replaceAll(/-(\w)/gm,a => a[1].toUpperCase())]=unquoted;}
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

  public processChss(rangeObject:Record<string, Set<TokenData>>,rules:ChssRule[],doc?:TextDocument,insensitive=false):ChssMatch[]{
    const matched:ProtoChssMatch[] = [];
    const combined = new Map<string,ChssMatch>();
    for (const {selector,style,scope,colorActions} of rules) {
      if (scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue;
      for (const parsed of selector) {
        const targetType = parsed.type;
        if (!(targetType in rangeObject) && targetType !== '*') continue;
        for (const {name,range,modifiers} of targetType === '*'?Object.keys(rangeObject).flatMap(k => [...rangeObject[k]]):rangeObject[targetType]) {
          // console.log({parsed,matched : parsed.match && this.matchName(name,parsed.match, parsed.name,parsed.regexp)})
          const [tName,sName] = [name,parsed.name].map(s => (insensitive?s.toLowerCase():s));
          if ((!sName || sName === tName || (parsed.match && this.matchName(tName,parsed.match, sName,parsed.regexp))) && !parsed.modifiers.some(m => !modifiers.includes(m))) matched.push({range,style,colorActions,pseudo:parsed.pseudo,specificity:parsed.specificity});
        }
      }
    }

    for (const current of matched){
      const {range, style,colorActions,pseudo} =current;
      const rangeIdent = [range.start.line,range.start.character,range.end.line,range.end.character,pseudo].join('|');
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
        combined.set(rangeIdent,{range, style:sA<sB?{...style, ...old.style}:{...old.style, ...style} , specificity:Math.max(sA,sB),pseudo});
      }
    }
    return [...combined.values()];
  }

}