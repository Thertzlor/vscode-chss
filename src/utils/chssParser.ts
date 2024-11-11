import {Range ,languages, RelativePattern,window,ViewColumn} from 'vscode';
import color from 'tinycolor2';
import {rangeToIdentifier} from './helperFunctions';
import type {TextDocument, Uri} from 'vscode';
import type {TokenCollection} from './rangesByName';
import type {RangeIdentifier} from './helperFunctions';
import {DomSimulator} from './domSimulator';

type MatchType = 'endsWith'|'startsWith'|'includes'|'match';
export interface ParsedSelector {type:string[], operator?:string, invalid?:boolean, specificity:Specifity, name:string, modifiers:string[][], scopes?:string[],match?:MatchType,regexp?:RegExp,pseudo?:Pseudo,notSelectors:ParsedSelector[][]}
interface ChssRule {selectors:ParsedSelector[], style:Record<string,string>, scope?:string, colorActions?:Map<string,[ColorAction,string]>}
interface ProtoChssMatch {range:Range, style:Record<string,string>,pseudo?:Pseudo, specificity:Specifity,colorActions?:Map<string,[ColorAction,string]>}
type ChssMatch = Omit<ProtoChssMatch,'colorActions'>;
export type Pseudo = typeof pseudos[number];
type ColorAction = typeof colorMods[number];

type MiniMatch = [ranges:Range[],spec:Specifity,pseudo?:Pseudo];
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
    private readonly colorMap= new Map<string,string>()
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

      if (mType === 'match' && !value.includes('*') && !/^"\/.+\/i?"$/.test(value)) return invalid;
      const insense = value.slice(0,-1).endsWith('/i');
      const regexp=mType === 'match'?new RegExp(value.startsWith('"') && value.endsWith('"')?value.slice(2,insense?-3:-2):`^${value.replace('*','.*')}$`,insense && value.startsWith('"')?'i':undefined):undefined;

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

  private async selectorsToRanges(selectorium:ParsedSelector[],complex:boolean|undefined,rangeObject:TokenCollection,insensitive?:boolean,doc?:TextDocument,domReused?:DomSimulator):Promise<MiniMatch[]>{
    const dom = doc && complex? domReused ?? await DomSimulator.init(doc.uri, rangeObject,doc):undefined;
    if (dom){
      // console.log('I have a dom');
      // const wbv = window.createWebviewPanel('dummyDom', 'Your Dom', {preserveFocus:true,viewColumn:ViewColumn.Beside});
      // wbv.webview.html = dom.getHtml();
      // for (const r of rules.flatMap(s => s.selector)) console.log(dom.selectorToQuery(r));
    }

    const tokenOnlyMatch = async(parsed:ParsedSelector) => {
      const tarray = parsed.type.includes('*')?['*']:parsed.type;
      const ranges = [] as Range[];
      const antiRanges = parsed.notSelectors.length?(await Promise.all(parsed.notSelectors.map(sels => this.selectorsToRanges(sels, isCompund(sels), rangeObject,insensitive,doc,dom)))).flat().flatMap(m => m[0]):[];
      for (const targetType of tarray) {
        if (!(targetType in rangeObject) && targetType !== '*') continue;
        for (const {name,range,modifiers} of targetType === '*'?rangeObject._all:rangeObject[targetType]) {
          const [tName,sName] = [name,parsed.name].map(s => (insensitive?s.toLowerCase():s));
          if ((!sName || sName === tName || (parsed.match && matchName(tName,parsed.match, sName,parsed.regexp))) && rightModifiers(parsed.modifiers,modifiers) && !antiRanges.some(a => a.intersection(range))) ranges.push(range);
        }
      }
      return ranges;
    };

    const processWithTokens = (selectors:ParsedSelector[]) => Promise.all(selectors.map(parsed => (tokenOnlyMatch(parsed).then(range => [range,parsed.specificity,parsed.pseudo]) as Promise<MiniMatch>)));
    const processWithDom = async(selectors:ParsedSelector[]) => {
      if (!dom) return [];
      const selectorGroups = [[]] as (ParsedSelector|string)[][];
      for (const pSelect of selectors){
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
            const antiRanges = element.notSelectors.length?(await Promise.all(element.notSelectors.map(sels => this.selectorsToRanges(sels, isCompund(sels), rangeObject,insensitive,doc,dom)))).flat().flatMap(m => m[0]):undefined;
            accumulator = dom.selectorToQuery(element,accumulator,element.regexp?await tokenOnlyMatch(element):undefined,antiRanges);
          }

        }
        finalSelectors.push(accumulator.join(', '));
        finalParsed.push(group.filter(v => typeof v !== 'string').at(-1)!);
      }

      return finalSelectors.map((fn,i) => [dom.rangesFromQuery(fn),finalParsed[i].specificity,finalParsed[i].pseudo] as MiniMatch);
    };

    if (complex && dom) return processWithDom(selectorium);
    return processWithTokens(selectorium);
  }


  public async processChss(rangeObject:TokenCollection,rules:ChssRule[],doc?:TextDocument,insensitive=false):Promise<ChssMatch[]>{
    const matched:ProtoChssMatch[] = [];
    const combined = new Map<RangeIdentifier,ChssMatch>();
    // We only need the DOM for complex rules


    for (const {selectors,style,scope,colorActions} of rules) {
      if (scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue;
      for (const [ranges,specificity,pseudo] of await this.selectorsToRanges(selectors, isCompund(selectors), rangeObject,insensitive,doc)) {for (const range of ranges) matched.push({range,style,colorActions,pseudo,specificity});}
    }

    for (const current of matched){
      const {range, style,colorActions,pseudo} =current;
      const rangeIdent = rangeToIdentifier(range,pseudo);

      // Random is a special case that does not need any preexisting color.
      for (const [name,[action]] of colorActions?.entries() ?? []) {
        if (action !== 'random') continue;
        style[name] = color.random().toHex8String();
      }

      if (!combined.has(rangeIdent)) combined.set(rangeIdent, current);
      else {
        const old = combined.get(rangeIdent)!;
        const [sA, sB] = [current,old].map(s => s.specificity);
        const moreSpecific = this.moreSpecific(sB,sA);

        if (!moreSpecific && colorActions){
          for (const [name,[action,args]] of colorActions.entries()) {
            if (action === 'random') continue;
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
        combined.set(rangeIdent,{range, style:moreSpecific?{...style, ...old.style}:{...old.style, ...style} , specificity:sA.map((s,i) => Math.max(s,sB[i])) as Specifity,pseudo});
      }
    }
    return [...combined.values()];
  }

}