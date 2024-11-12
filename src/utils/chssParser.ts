import {Range ,languages, RelativePattern,window,ViewColumn, workspace} from 'vscode';
import color from 'tinycolor2';
import {TextDocument, Uri} from 'vscode';
import type {TokenCollection} from './rangesByName';
import {DomSimulator} from './domSimulator';

type MatchType = 'endsWith'|'startsWith'|'includes'|'match';
export interface ParsedSelector {type:string[], operator?:string, invalid?:boolean, specificity:Specifity, name:string, modifiers:string[][], scopes?:string[],match?:MatchType,regexp?:RegExp,pseudo?:Pseudo,notSelectors:ParsedSelector[][]}
interface ChssRule {selectors:ParsedSelector[], style:Record<string,string>, scope?:string, colorActions?:Map<string,[ColorAction,string]>}
interface ProtoChssMatch {range:Range, style:Record<string,string>,pseudo?:Pseudo, specificity:Specifity,colorActions?:Map<string,[ColorAction,string]>,offset:number}
type ChssMatch = Omit<ProtoChssMatch,'colorActions'>;
export type Pseudo = typeof pseudos[number];
type ColorAction = typeof colorMods[number];

type MiniMatch = [ranges:Range[],spec:Specifity,offs:number[],pseudo?:Pseudo];

export type MatchPair = [Range[],number[]];
type Specifity = [_id:number,_class:number,_type:number];

const colorMods = ['lighten','brighten','darken','desaturate','saturate','spin','greyscale','random'] as const;
const pseudos = ['before', 'after', 'light', 'dark'] as const;

const sumSpecificity = ([a1,b1,c1]:Specifity,[a2,b2,c2]:Specifity):Specifity => [a1+a2,b1+b2,c1+c2];

const rightModifiers = (modGroups:string[][],modifiers:string[]) => !modGroups.length || modGroups.every(group => !group.length || (group.includes('none')? !modifiers.length: modifiers.some(m => group.includes(m))));

const matchName = (name:string,type:MatchType,val:string,reg?:RegExp) => (reg?reg.test(name):!!name[type](val));

const isCompund = (selectors:ParsedSelector[]) => selectors.some(s => s.operator && s.operator !== ',');

export class ChssParser{
  constructor(
    private readonly baseUri?:Uri,
    private readonly colorMap= new Map<string,string>(),
    private readonly doms = new Map<string,DomSimulator>()
  ){}

  private moreSpecific([i1,c1,t1]:Specifity,[i2,c2,t2]:Specifity) {
    if (i1 !== i2) return i1>i2;
    if (c1 !== c2) return c1>c2;
    if (t1 !== t2) return t1>t2;
    return false;
  }

  private parseSelector(rawSelector:string,base:Specifity=[0,0,0],operator?:string):ParsedSelector{
    const invalid = {specificity:[-1,-1,-1] as Specifity, name:'', type:[''],modifiers:[],notSelectors:[],operator:'',invalid:true};
    const pseudo = pseudos.find(b => rawSelector.includes(`::${b}`));
    let selector = pseudo?rawSelector.replaceAll(`::${pseudo}`, ''):rawSelector;

    const notEx = /:not\([^)]*?\)/;
    /** container for not() queries */
    const nots = [] as string[];

    for (let notMatch = notEx.exec(selector); notMatch; notMatch = notEx.exec(selector)) {
      const notStr = notMatch[0];
      const index = notMatch.index;
      const sliced = notStr.slice(5,-1);
      if (sliced) nots.push(sliced);
      selector = `${selector.slice(0,index)}${selector.slice(index+notStr.length)}`;
    }

    const notSelectors = [] as ParsedSelector[][];
    for (const not of nots) {
      // recursion! ...but :not() can't be nested, so it can't be infinite.
      const np = this.stringToSelectors(not,base);
      // If one :not() selector is invalid the whole selector is invalid
      if (np.some(n => n.invalid)) return invalid;
      notSelectors.push(np);
    }

    if (selector === '*') return {specificity:sumSpecificity(base,[0,0,0]), name:'', type:['*'],modifiers:[],pseudo,notSelectors,operator};
    if (/^\w+$/.test(selector)) return {specificity:sumSpecificity(base,[1,0,0]), name:selector, type:['*'],modifiers:[],pseudo,notSelectors,operator}; // name selector for all types: name

    if (/^\w+$/.test(selector.slice(1)) && !selector.startsWith(':')){
      const sliced = selector.charAt(0);

      switch (sliced) {
      case '#': return {specificity:sumSpecificity(base,[1,1,0]), name:selector.slice(1), type:['variable'],modifiers:[],pseudo,notSelectors,operator}; //variable: #name
      case '.': return {specificity:sumSpecificity(base,[1,1,0]), name:selector.slice(1), type:['function'],modifiers:[],pseudo,notSelectors,operator}; //function: .name
      default: return invalid;
      }
    }

    if (selector.startsWith('<') && selector.endsWith('>')){ // Advanced match: <wildc*rd> | <^=textmatch> | <"/RegEx/"> | <^=match=type>
      const [matcher,val,rawType] = selector.slice(1,-1).split('=').map(s => ((t=s.trim()) => (t.startsWith('"') && t.endsWith('"')?t.slice(1,-1):t))());
      //console.log({operator,val});
      const ops:Record<string,MatchType|undefined> = {'^':'startsWith','*':'includes',$:'endsWith'};
      const mType:MatchType = ops[matcher] ?? 'match';
      const matchSpecs = {match:4,startsWith:3,endsWith:3,includes:2};
      const value = val || matcher;

      if (mType === 'match' && !value.includes('*') && !/^\/.+\/i?$/.test(value)) return invalid;
      const insense = value.slice(0,-1).endsWith('/i');
      const regexp=mType === 'match'?new RegExp(value.startsWith('/')?value.slice(1,insense?-2:-1):`^${value.replace('*','.*')}$`,insense && value.startsWith('"')?'i':undefined):undefined;

      let manualType = rawType;

      if (rawType) manualType = rawType.includes(':') ? ((c = rawType.indexOf(':')) => `[${rawType.slice(0,c)}]${rawType.slice(c)}`)() : `[${rawType}]`;

      const {type=['*'],modifiers=[],specificity:[id,cl,ty]=[0,0,0]} = rawType? this.parseSelector(manualType,base):{};
      if (id === -1) return invalid;
      return {specificity:[id,cl+matchSpecs[mType],ty], name:value, type,modifiers,regexp,match:mType,pseudo,notSelectors,operator};
    }
    if (selector.startsWith('[') && selector.endsWith(']')) return {specificity:sumSpecificity(base,[0,1,0]), name:'', type:selector.slice(1,-1).split('/').map(t => t.trim()),modifiers:[],pseudo,notSelectors,operator}; // general type: [variable]
    if (selector.startsWith('[')){ // extended type with one or more modifiers: [variable]:readonly
      const [sel='',...modifiers] = selector.split(':');

      if (!modifiers.length || !sel.endsWith(']')) return invalid;
      return {specificity:sumSpecificity(base,[0,1,modifiers.length]), name:'', type:sel.slice(1,-1).split('/').map(t => t.trim()),modifiers:modifiers.map(m => m.split('/')),pseudo,notSelectors,operator};
    }
    if (selector.includes('[') && selector.includes(']')){ //compound: name[variable]:readonly
      if (!/\w/.test(selector.charAt(0))) return invalid;//eslint-disable-next-line unicorn/better-regex
      const [name,type,mods] = selector.split(/\[|\]/gm);

      if (!type) return invalid;
      if (!mods) return {specificity:sumSpecificity(base,[1,1,0]), name, type:type.split('/').map(t => t.trim()),modifiers:[],notSelectors,operator};
      const splitMods = mods.split(':').filter(s => s);

      return {specificity:sumSpecificity(base,[1,1,mods.length]), name, type:type.split('/').map(t => t.trim()),modifiers:splitMods.map(m => m.split('/')),pseudo,notSelectors,operator};
    }
    if (selector.includes('[') || selector.includes(']')) return invalid;
    // name with modifiers: variable:modifier
    const [ident, ...splitMods] = selector.split(':');

    if (!ident) return splitMods.length? {specificity:sumSpecificity(base,[0,0,splitMods.length]), name:'', type:['*'],modifiers:splitMods.map(m => m.split('/').map(t => t.trim())),pseudo,notSelectors,operator}:invalid;
    const {specificity:[id,cl,ty],name,type} = ident!=='/'?this.parseSelector(ident,base):{specificity:[-1] as const,name:'',type:['']};

    if (id === -1) return invalid;

    return {specificity:[id,cl!,ty!+splitMods.length], name, type,modifiers:splitMods.map(m => m.split('/')),pseudo,notSelectors,operator};
  }

  private stringToSelectors(sourceStr:string,baseVal:Specifity = [0,0,0]){
    // This regex is getting pretty nuts.
    const rulEx = /[#.]?\w+(?:\[[^]*?]+)?(?::\w+(?:\([^)]*?\))?)*|<[^>]+?>|(?::\w+(?:\([^)]*?\))?)+|\[[^]*?]+(?::+\w+(?:\([^)]*?\))?)*|\*(?:$|\s)/g;
    const selectorMatches = [];
    const operators = [];
    let lastMatch = 0;

    for (let selectMatch = rulEx.exec(sourceStr); selectMatch; selectMatch = rulEx.exec(sourceStr)) {
      if (lastMatch)operators.push(sourceStr.slice(lastMatch,selectMatch.index).trim()|| ' ');
      const mainMatch = selectMatch[0].trim();
      lastMatch = selectMatch.index+mainMatch.length;
      if (mainMatch.length)selectorMatches.push(mainMatch);
    }
    const processedSelectors = [] as ParsedSelector[];
    let combinedSpecificity=baseVal;
    for (const [j,m] of selectorMatches.entries()){
      const parsed = this.parseSelector(m,combinedSpecificity,operators[j]);
      if (
        //Handling exiting upon invalid pseudo selectors
        (parsed.pseudo && parsed.operator && parsed.operator !== ',') ||
        //Invalid selectors thar are part of a compound invalidate the entire compound.
        (parsed.invalid && ((processedSelectors.at(-1)?.operator && processedSelectors.at(-1)!.operator !== ',') || (parsed.operator && parsed.operator !== ',')))
      ){
        processedSelectors.length = 0;
        break;
      }
      if (!parsed.invalid){
        processedSelectors.push(parsed);
        combinedSpecificity = parsed.operator === ','?baseVal:sumSpecificity(combinedSpecificity,parsed.specificity);
      } else combinedSpecificity = baseVal;
    }
    return processedSelectors;
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
          currentScope = v.match(/.*\((.*)\)$/)?.[1].trim().replace(/^"|"$/,'').replaceAll('\\','/') || '???';
          continue;
        }
        const baseVal:Specifity = currentScope?[1,0,0]:[0,0,0];
        const selectors= this.stringToSelectors(v,baseVal);
        if (!selectors.length){skipNext = true; continue;}
        const protoRule:ChssRule = {selectors,style:{}};
        if (currentScope)protoRule.scope = currentScope;
        res.push(protoRule);
      }
      else {
        if (!v || v === 'empty'){res.pop(); continue;}
        const rules = v.split(';').map(s => s.trim()).filter(s => s);

        if (!rules.length){res.pop(); continue;}
        const ruleObj = {} as Record<string,string>;
        const cMap = this.parseColorRules(rules, ruleObj);
        const cuRule = res.at(-1);
        if (cuRule){
          cuRule.style = ruleObj;
          if (cMap.size) cuRule.colorActions=cMap;
        }
      }
    }
    return res;
  }

  private parseColorRules(rules:string[], ruleObj:Record<string, string>) {
    const cMap= new Map<string,[ColorAction,string]>();
    for (const r of rules) {
      const [_, name, value] = [...r.match(/^([^:]+):(.*)$/) ?? [void 0]].map(s => s?.trim());
      if (name && value) {
        const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
        if (colorMods.some(m => value.startsWith(`${m}(`))) {
          const [mode, arg] = value.split(/\(|\)/gm).map(s => s.trim());
          cMap.set(name, [mode as ColorAction, arg]);
        }
        else ruleObj[name.replaceAll(/-(\w)/gm, a => a[1].toUpperCase())] = unquoted;
      }
    }
    return cMap;
  }

  private applyColorActions(colorActions:Map<string, [ColorAction,string]>, old:ChssMatch, style:Record<string, string>) {
    for (const [name, [action, args]] of colorActions.entries()) {
      if (action === 'random') continue;
      if (!(name in old.style)) continue;

      const colorIdent = [old.style[name], action, args].join('-');
      if (this.colorMap.has(colorIdent)) {
        style[name] = this.colorMap.get(colorIdent)!;
        continue;
      }

      const oldCol = color(old.style[name]);
      if (!oldCol.isValid()) continue;

      const newCol = oldCol[action](args ? parseInt(args, 10) : undefined as never);
      if (newCol.isValid()) {
        const hexa = newCol.toHex8String();
        this.colorMap.set(colorIdent, hexa);
        style[name] = hexa;
      }
    }
  }

  private async selectorsToMatches(selectors:ParsedSelector[],complex:boolean|undefined,rangeObject:TokenCollection,insensitive?:boolean,doc?:TextDocument):Promise<MiniMatch[]>{
    if (doc && complex &&!this.doms.has(doc.uri.toString())) this.doms.set(doc.uri.toString(), await DomSimulator.init(doc.uri, rangeObject,doc));

    const tokenOnlyMatch = async(parsed:ParsedSelector):Promise<MatchPair> => {
      const tarray = parsed.type.includes('*')?['*']:parsed.type;
      const matches = [[],[]] as MatchPair;
      const antiRanges = await this.getAntiMatches(parsed, rangeObject, insensitive, doc);
      for (const targetType of tarray) {
        if (!rangeObject.byType.has(targetType) && targetType !== '*') continue;
        for (const {name,range,modifiers,offset} of targetType === '*'?rangeObject.all:rangeObject.byType.get(targetType)!) {
          const [tName,sName] = [name,parsed.name].map(s => (insensitive?s.toLowerCase():s));
          if ((!sName || sName === tName || (parsed.match && matchName(tName,parsed.match, sName,parsed.regexp))) && rightModifiers(parsed.modifiers,modifiers) && !antiRanges?.[1].includes(offset)){
            matches[0].push(range);
            matches[1].push(offset);
          }
        }
      }
      return matches;
    };

    const processWithTokens = (selects:ParsedSelector[]) => Promise.all(selects.map(parsed => tokenOnlyMatch(parsed).then(([r,o]) => [r,parsed.specificity,o,parsed.pseudo] as MiniMatch)));
    const processWithDom = async(selects:ParsedSelector[]) => {
      const dom = doc? this.doms.get(doc.uri.toString()):undefined;
      if (!dom) return [];
      const selectorGroups = [[]] as (ParsedSelector|string)[][];
      for (const pSelect of selects){
        const currentGroup = selectorGroups.at(-1)!;
        const nextOperator = pSelect.operator;
        const payload = [pSelect] as (ParsedSelector|string)[];
        if (nextOperator && nextOperator === ',') selectorGroups.push([]);
        else if (nextOperator) payload.push(nextOperator);
        currentGroup.push(...payload);
      }
      const finalSelectors = [] as string[];
      const finalParsed = [] as ParsedSelector[];
      for (const group of selectorGroups){
        let accumulator = ['div'] as string[];
        for (const element of group){
          if (typeof element === 'string'){
            accumulator = accumulator.map(s => `${s} ${element}`);
          } else {
            const antiRanges = await this.getAntiMatches(element, rangeObject, insensitive, doc);
            accumulator = dom.selectorToQuery(element,accumulator,element.regexp?(await tokenOnlyMatch(element))[1]:undefined,antiRanges?.[1]);
          }
        }
        finalSelectors.push(accumulator.join(', '));
        finalParsed.push(group.filter(v => typeof v !== 'string').at(-1)!);
      }
      const tunre = finalSelectors.map((fn, i) => ((mp = dom.matchesFromQuery(fn)) => [mp[0], finalParsed[i].specificity, mp[1], finalParsed[i].pseudo] as MiniMatch)());
      return tunre;
    };

    if (complex && this.doms.has(doc?.uri.toString() ?? '')) return processWithDom(selectors);
    return processWithTokens(selectors);
  }

  private async getAntiMatches(element:ParsedSelector, rangeObject:TokenCollection, insensitive?:boolean, doc?:TextDocument) {
    return element.notSelectors.length ? (await Promise.all(element.notSelectors.map(sels => this.selectorsToMatches(sels, isCompund(sels), rangeObject, insensitive, doc)))).flat().reduce<MatchPair>((p,[ranges,_,offsets]) => {
      p[0].push(...ranges);
      p[1].push(...offsets);
      return p;
    }, [[],[]]) : undefined;
  }


  public async processChss(rangeObject:TokenCollection,rules:ChssRule[],doc?:TextDocument,insensitive=false):Promise<ChssMatch[]>{
    doc && this.doms.delete(doc.uri.toString());
    const matched:ProtoChssMatch[] = [];
    const combined = new Map<string,ChssMatch>();
    // We only need the DOM for complex rules

    for (const {selectors,style,scope,colorActions} of rules) {
      if (scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue;
      for (const [ranges,specificity,offsets,pseudo] of await this.selectorsToMatches(selectors, isCompund(selectors), rangeObject,insensitive,doc)) {for (const [i,range] of ranges.entries()) matched.push({range,style,colorActions,pseudo,specificity,offset:offsets[i]});}
    }

    for (const current of matched){
      const {range, style,colorActions,pseudo,offset} =current;
      const identifier = `${offset}${pseudo??''}`;

      // Random is a special case that does not need any preexisting color.
      for (const [name,[action]] of colorActions?.entries() ?? []) {
        if (action !== 'random') continue;
        style[name] = color.random().toHex8String();
      }

      if (!combined.has(identifier)) combined.set(identifier, current);
      else {
        const old = combined.get(identifier)!;
        const [sA, sB] = [current,old].map(s => s.specificity);
        const moreSpecific = this.moreSpecific(sB,sA);
        if (!moreSpecific && colorActions) this.applyColorActions(colorActions, old, style);
        combined.set(identifier,{range, offset, style:moreSpecific?{...style, ...old.style}:{...old.style, ...style} , specificity:sA.map((s,i) => Math.max(s,sB[i])) as Specifity,pseudo});
      }
    }
    return [...combined.values()];
  }
}