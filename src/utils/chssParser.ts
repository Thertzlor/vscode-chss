import {languages,RelativePattern, window,ViewColumn,WebviewPanel} from 'vscode';
import color from 'tinycolor2';
import {DomSimulator} from './domSimulator';
import {setFreshStyle} from './helperFunctions';
import type {TokenCollection} from './rangesByName';
import type {TextDocument, Uri, Range} from 'vscode';

type MatchType = 'endsWith'|'startsWith'|'includes'|'match';
export interface ParsedSelector {type:string[], combinator?:string, invalid?:boolean, specificity:Specificity, name:string, modifiers:string[][], scopes?:string[],match?:MatchType,regexp?:RegExp,pseudo?:Pseudo,notSelectors:ParsedSelector[][]}
interface ChssRule {selectors:ParsedSelector[], style:Record<string,string>, scope?:string, colorActions?:Map<string,[ColorAction,string]>}
interface ProtoChssMatch {range:Range, style:Record<string,string>,pseudo?:Pseudo, specificity:Specificity,colorActions?:Map<string,[ColorAction,string]>,offset:number}
type ChssMatch = Omit<ProtoChssMatch,'colorActions'>;
export type Pseudo = typeof pseudos[number];
type ColorAction = typeof colorMods[number];

type FullMatch = [ranges:Range[],spec:Specificity,offs:number[],pseudo?:Pseudo];

export type MatchPair = [Range[],number[]];
type Specificity = [_id:number,_class:number,_type:number];
/** A list of all valid color actions. */
const colorMods = ['lighten','brighten','darken','desaturate','saturate','spin','greyscale','random'] as const;
/** A list of all valid pseudo classes */
const pseudos = ['before', 'after', 'light', 'dark'] as const;


const matchName = (name:string,type:MatchType,val:string,reg?:RegExp) => (reg?reg.test(name):!!name[type](val));

/**
 * Determines if a selector group is linked with combinators other than `,`
 * @param selectors -A group of CHSS selector objects
 */
const isCompound = (selectors:ParsedSelector[]) => selectors.some(s => s.combinator && s.combinator !== ',');

/**
 * Determines if the modifiers on a token match a list of modifier groups.
 * @param modGroups - A list of modifier groups
 * @param modifiers - A list of modifiers found on a token
 */
const rightModifiers = (modGroups:string[][],modifiers:string[]) => !modGroups.length || modGroups.every(group => !group.length || (group.includes('none')? !modifiers.length: modifiers.some(m => group.includes(m))));

/**
 * Summing the specificity of two selectors.
 * @param a - Selector 1
 * @param b - Selector 2
 * @returns The combined specificity.
 */
const sumSpecificity = ([a1,b1,c1]:Specificity,[a2,b2,c2]:Specificity):Specificity => [a1+a2,b1+b2,c1+c2];

/**
 * Checks if one specificity array is more specific than another using the same logic as in regular CSS.
 * @param specificityA - The first specificity
 * @param specificityB - The second specificity
 */
const isMoreSpecific = ([i1,c1,t1]:Specificity,[i2,c2,t2]:Specificity) => {
  if (i1 !== i2) return i1>i2;
  if (c1 !== c2) return c1>c2;
  if (t1 !== t2) return t1>t2;
  return false;
};

export class ChssParser{
  constructor(
    private readonly baseUri?:Uri,
    private readonly colorMap= new Map<string,string>(),
    private readonly doms = new Map<string,DomSimulator>(),
    private webview?:WebviewPanel
  ){}

  /**
   * A gnarly minimal parser for pseudo css.
   * @param source -The source code of the file
   */
  public parseChss(source:string){
    setFreshStyle();
    const res = [] as ChssRule[];
    let skipNext = false;
    let currentScope:string|undefined;
    //We iterate through the file, after removing comments and splitting the text by brackets. This only works because we never nest rules more than once.
    for (const [i,value] of source.replaceAll(/\/\/.*/g,'').replaceAll(/{\s*}/gm,'{empty}').split(/[{}]/gm).map(s => s.trim()).entries()) {
      /**Outside of scope() blocks selectors are always uneven entries, but with they are the even ones.*/
      const isSelector = i % 2 === (currentScope?1:0);
      //If we're in a scoped block and we get an empty value, this means we're at the end of the block.
      if (currentScope && !value){currentScope = undefined; continue;}
      // If the last selector was invalid, we skip the upcoming rule.
      if (skipNext){skipNext = false; continue;}
      //Missing Selector = skip
      if (isSelector && !value) {skipNext = true; continue;}

      if (isSelector){
        //Special case for scope() directives (this is technically a mixin as far as SCSS highlighting is concerned)
        if (value.startsWith('scope(')){
          //Parsing the glob pattern from the function.
          currentScope = value.match(/.*\((.*)\)$/)?.[1].trim().replaceAll(/^"|"$/g,'').replaceAll('\\','/') || '???';
          continue;
        }
        //By increasing the base Specificity, we make sure that scoped rules always beat out non-scoped rules.
        const baseVal:Specificity = currentScope?[1,0,0]:[0,0,0];
        const selectors= this.stringToSelectors(value,baseVal);
        //No valid selectors found.
        if (!selectors.length){skipNext = true; continue;}

        //All selectors valid! We push an empty rule object onto our array, which will be filled from the next section
        const protoRule:ChssRule = {selectors,style:{}};
        if (currentScope)protoRule.scope = currentScope;
        res.push(protoRule);
      }
      // Here, we are in a rule block
      else {
        if (!value || value === 'empty'){res.pop(); continue;}
        const rules = value.split(';').map(s => s.trim()).filter(s => s);
        if (!rules.length){res.pop(); continue;}
        const [cMap,ruleObj] = this.parseRuleProperties(rules);
        const cuRule = res.at(-1);
        if (cuRule){
          cuRule.style = ruleObj;
          if (cMap.size) cuRule.colorActions=cMap;
        }
      }
    }
    return res;
  }

  public async processChss(rangeObject:TokenCollection,rules:ChssRule[],doc?:TextDocument,insensitive=false,debug=false):Promise<ChssMatch[]>{
    doc && this.doms.delete(doc.uri.toString());
    const matched:ProtoChssMatch[] = [];
    const combined = new Map<string,ChssMatch>();

    for (const {selectors,style,scope,colorActions} of rules) {
      //We are skipping any rules not scoped to the current document.
      if (scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue;
      //We go through each selector and find out, which ranges we match with which specificity.
      for (const [ranges,specificity,offsets,pseudo] of await this.selectorsToMatches(selectors, isCompound(selectors), rangeObject,insensitive,doc,debug)) {for (const [i,range] of ranges.entries()) matched.push({range,style,colorActions,pseudo,specificity,offset:offsets[i]});}
    }

    for (const current of matched){
      const {range, style,colorActions,pseudo,offset} =current;
      //Only one rule can apply per offset, so that's the base of our comparison.
      const identifier = `${offset}${pseudo??''}`;

      // Random is a special case for color transforms that does not need any preexisting color.
      for (const [name,[action]] of colorActions?.entries() ?? []) {
        if (action !== 'random') continue;
        style[name] = color.random().toHex8String();
      }

      if (!combined.has(identifier)) combined.set(identifier, current);
      else {
        const old = combined.get(identifier)!;
        const [sA, sB] = [current,old].map(s => s.specificity);
        const moreSpecific = isMoreSpecific(sB,sA);
        //If the old color rule IS NOT more specific, it is used as a base for our color transformations.
        if (!moreSpecific && colorActions) this.applyColorActions(colorActions, old, style);
        // Cascade magic happens here. Lower specificity rules are overridden, others remain
        combined.set(identifier,{range, offset, style:moreSpecific?{...style, ...old.style}:{...old.style, ...style} , specificity:sA.map((s,i) => Math.max(s,sB[i])) as Specificity,pseudo});
      }
    }
    return [...combined.values()];
  }

  /**
   * Parses a string containing one or more CHSS selector strings into an array of selectors,  
   * Also resolves selectors separated by combinators.
   * @param sourceString - The string to parse.
   * @param baseSpecificity - The minimum specificity any returned selector will have.
   */
  private stringToSelectors(sourceString:string,baseSpecificity:Specificity = [0,0,0]){
    // This regex is getting pretty nuts.
    const rulEx = /[#.]?\w+(?:\[[^]*?]+)?(?::\w+(?:\([^)]*?\))?)*|<[^>]+?>|(?::\w+(?:\([^)]*?\))?)+|\[[^]*?]+(?::+\w+(?:\([^)]*?\))?)*|\*(?:$|\s)/g;
    const selectorMatches = [];
    const combinators = [];
    let lastMatch = 0;

    for (let selectMatch = rulEx.exec(sourceString); selectMatch; selectMatch = rulEx.exec(sourceString)) {
      if (lastMatch)combinators.push(sourceString.slice(lastMatch,selectMatch.index).trim()|| ' ');
      const mainMatch = selectMatch[0].trim();
      lastMatch = selectMatch.index+mainMatch.length;
      if (mainMatch.length)selectorMatches.push(mainMatch);
    }

    const processedSelectors = [] as ParsedSelector[];

    /**If we have selectors with combinators, their specificity is combined */
    let combinedSpecificity=baseSpecificity;
    for (const [j,m] of selectorMatches.entries()){
      const parsed = this.parseSingleSelector(m,combinedSpecificity,combinators[j]);
      if (
        //Handling selectors that are either generally invalid or have pseudo selectors in invalid positions.
        ((parsed.pseudo || parsed.invalid) && parsed.combinator && parsed.combinator !== ',') ||
        //Invalid selectors that are part of a compound selector invalidate the entire compound.
        (parsed.invalid && processedSelectors.at(-1)?.combinator && processedSelectors.at(-1)!.combinator !== ',')
      ){
        processedSelectors.length = 0;
        break;
      }
      if (!parsed.invalid){
        processedSelectors.push(parsed);
        // The comma combinator resets specificity because it doesn't compound.
        combinedSpecificity = parsed.combinator === ','?baseSpecificity:sumSpecificity(combinedSpecificity,parsed.specificity);
      } else combinedSpecificity = baseSpecificity;
    }
    return processedSelectors;
  }

  /**
   * Parses a string containing a single CHSS selector.
   * @param stringSelector - The string to parse
   * @param baseSpecifity - Minimum specificity the selector will have.
   * @param combinator - The combinator that will follow this selector
   */
  private parseSingleSelector(stringSelector:string,baseSpecifity:Specificity=[0,0,0],combinator?:string):ParsedSelector{
    /**The invalid selector that is returned, if we can't parse the string contents.  All fields are blank, only the  */
    const invalid = {specificity:[-1,-1,-1] as Specificity, name:'', type:[''],modifiers:[],notSelectors:[], combinator,invalid:true};
    const pseudo = pseudos.find(b => stringSelector.includes(`::${b}`));
    let selector = pseudo?stringSelector.replaceAll(`::${pseudo}`, ''):stringSelector;
    let currentSpecifity = baseSpecifity;

    const notEx = /:not\([^)]*?\)/;
    /** container for not() queries */
    const nots = [] as string[];

    //We keep matching and removing :not() selectors until none are left in the selector.
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
      const np = this.stringToSelectors(not,currentSpecifity);
      // If one :not() selector is invalid the whole selector is invalid
      if (np.some(n => n.invalid)) return invalid;
      notSelectors.push(np);
    }

    if (notSelectors.length){
      // CSS compliant behavior: The :not() selector adds the highest specificity of its selectors to the parent selector.
      const {specificity} = notSelectors.flat().sort((a,b) => (isMoreSpecific(a.specificity,b.specificity)?1:-1)).at(-1)!;
      currentSpecifity = sumSpecificity(currentSpecifity,specificity);
    }

    if (selector === '*') return {specificity:sumSpecificity(currentSpecifity,[0,0,0]), name:'', type:['*'],modifiers:[],pseudo,notSelectors,combinator};
    // name selector for all types: name
    if (/^\w+$/.test(selector)) return {specificity:sumSpecificity(currentSpecifity,[1,0,0]), name:selector, type:['*'],modifiers:[],pseudo,notSelectors,combinator};

    // name selector with at least one non-standard symbol 
    if (/^\w+$/.test(selector.slice(1)) && !selector.startsWith(':')){
      const sliced = selector.charAt(0);

      switch (sliced) {
      //variable: #name
      case '#': return {specificity:sumSpecificity(currentSpecifity,[1,1,0]), name:selector.slice(1), type:['variable'],modifiers:[],pseudo,notSelectors,combinator};
      //function: .name
      case '.': return {specificity:sumSpecificity(currentSpecifity,[1,1,0]), name:selector.slice(1), type:['function'],modifiers:[],pseudo,notSelectors,combinator};
      //any other special character is invalid.
      default: return invalid;
      }
    }

    // Advanced match: <wildc*rd> | <^=textmatch> | <"/RegEx/"> | <^=match=type>
    if (selector.startsWith('<') && selector.endsWith('>')){
      //removing quotes and whitespace, splitting the string
      const [operator,content,subSelector] = selector.slice(1,-1).split('=').map(s => ((t=s.trim()) => (t.startsWith('"') && t.endsWith('"')?t.slice(1,-1):t))());

      //Resolving the operator of our match function.
      const operations:Record<string,MatchType|undefined> = {'^':'startsWith','*':'includes',$:'endsWith'};
      const matchType:MatchType = operations[operator] ?? 'match';
      const matchSpecificty = {match:4,startsWith:3,endsWith:3,includes:2};

      //If there were only two in the split array, the match content is actually in the first position
      const value = content || operator;
      //The advanced match NEEDS either a RegEx or wildcards, otherwise just use a plain name. 
      if (matchType === 'match' && (!value.includes('*') && !/^\/.+\/i?$/.test(value))) return invalid;
      const insensitive = value.endsWith('/i');

      const regexp=matchType === 'match'?new RegExp(value.startsWith('/')?value.slice(1,insensitive?-2:-1):`^${value.replaceAll('*','.*')}$`,insensitive && value.startsWith('"')?'i':undefined):undefined;

      let typeFilter = subSelector;
      //Here we resolve the plain selector into a valid [type] selector, including :modifiers, if present.
      if (subSelector) typeFilter = subSelector.includes(':') ? ((c = subSelector.indexOf(':')) => `[${subSelector.slice(0,c)}]${subSelector.slice(c)}`)() : `[${subSelector}]`;

      // We parse the subselector, and adds its specificity to the main selector.
      const {invalid:inv,type=['*'],modifiers=[],specificity=[0,0,0]} = subSelector? this.parseSingleSelector(typeFilter,currentSpecifity):{};
      if (inv) return invalid;
      return {specificity:sumSpecificity(specificity,[0,matchSpecificty[matchType],0]), name:value, type,modifiers,regexp,match:matchType,pseudo,notSelectors,combinator};
    }
    // general type: [variable]
    if (selector.startsWith('[') && selector.endsWith(']')) return {specificity:sumSpecificity(currentSpecifity,[0,1,0]), name:'', type:selector.slice(1,-1).split('/').map(t => t.trim()),modifiers:[],pseudo,notSelectors,combinator};
    // extended type with one or more modifiers: [variable]:readonly
    if (selector.startsWith('[')){
      const [sel='',...modifiers] = selector.split(':');

      if (!modifiers.length || !sel.endsWith(']')) return invalid;
      return {specificity:sumSpecificity(currentSpecifity,[0,1,modifiers.length]), name:'', type:sel.slice(1,-1).split('/').map(t => t.trim()),modifiers:modifiers.map(m => m.split('/')),pseudo,notSelectors,combinator};
    }
    //compound: name[variable]:readonly
    if (selector.includes('[') && selector.includes(']')){
      if (!/\w/.test(selector.charAt(0))) return invalid;//eslint-disable-next-line unicorn/better-regex
      const [name,type,mods] = selector.split(/\[|\]/gm);

      if (!type) return invalid;
      // Returning a selector without modifiers
      if (!mods) return {specificity:sumSpecificity(currentSpecifity,[1,1,0]), name, type:type.split('/').map(t => t.trim()),modifiers:[],notSelectors,combinator};
      const splitMods = mods.split(':').filter(s => s);
      //More modifiers = more specific
      return {specificity:sumSpecificity(currentSpecifity,[1,1,mods.length]), name, type:type.split('/').map(t => t.trim()),modifiers:splitMods.map(m => m.split('/')),pseudo,notSelectors,combinator};
    }
    if (selector.includes('[') || selector.includes(']')) return invalid;
    // name with modifiers: variable:modifier
    const [ident, ...splitMods] = selector.split(':');

    if (!ident) return splitMods.length? {specificity:sumSpecificity(currentSpecifity,[0,0,splitMods.length]), name:'', type:['*'],modifiers:splitMods.map(m => m.split('/').map(t => t.trim())),pseudo,notSelectors,combinator}:invalid;
    const {specificity,name,type,invalid:inv} = ident!=='/'?this.parseSingleSelector(ident,currentSpecifity):invalid;
    if (inv) return invalid;
    return {specificity:sumSpecificity(specificity,[0,0,splitMods.length]), name, type,modifiers:splitMods.map(m => m.split('/')),pseudo,notSelectors,combinator};
  }

  /**
   * Takes a list of parsed selectors and returns a their matched offsets and ranges.
   * @param selectors - An array of selectors.
   * @param complex - True if combinators are involved.
   * @param tokenOject - All tokens of the current document
   * @param insensitive - Case sensitivity setting
   * @param doc - The text document to be styled.
   * @param debug - If true, will trigger the WebView for our DOM.
   */
  private async selectorsToMatches(selectors:ParsedSelector[],complex:boolean|undefined,tokenOject:TokenCollection,insensitive?:boolean,doc?:TextDocument,debug=false):Promise<FullMatch[]>{
    //If we don't have our DOM, but we need it, we initialize it here.
    if (doc && complex &&!this.doms.has(doc.uri.toString())) this.doms.set(doc.uri.toString(), await DomSimulator.init(doc.uri, tokenOject,doc));
    // Debug WebView
    if (debug && this.doms.has(doc?.uri.toString() ?? '')){
      if (!this.webview){
        this.webview = window.createWebviewPanel('domDebugView', 'Dom Debug Preview', {preserveFocus:true,viewColumn:ViewColumn.Beside},{enableFindWidget:true,retainContextWhenHidden:true});
        this.webview.onDidDispose(() => this.webview = undefined);
      }
      this.webview.webview.html = this.doms.get(doc!.uri.toString())!.getHtml();
    }

    /**
     * This function matches a selector by scanning the token lists of your document for matching tokens.  
     * This will not resolve compound selectors. If any :not() selectors are compounds selectors, DOM selection is used for them.
     * @param parsed - The selector to match.
     */
    const tokenOnlyMatch = async(parsed:ParsedSelector):Promise<MatchPair> => {
      const tarray = parsed.type.includes('*')?['*']:parsed.type;
      const matches = [[],[]] as MatchPair;
      //First, we get all our matched :not() selectors
      const antiRanges = await this.getNotMatches(parsed, tokenOject, insensitive, doc);
      for (const targetType of tarray) {
        //If the target has an unknown type, we can skip it.
        if (!tokenOject.byType.has(targetType) && targetType !== '*') continue;
        for (const {name,range,modifiers,offset} of targetType === '*'?tokenOject.all:tokenOject.byType.get(targetType)!) {
          const [tName,sName] = [name,parsed.name].map(s => (insensitive?s.toLowerCase():s));
          //Main comparison logic for name and modifier matching.
          if ((!sName || sName === tName || (parsed.match && matchName(tName,parsed.match, sName,parsed.regexp))) && rightModifiers(parsed.modifiers,modifiers) && !antiRanges.includes(offset)){
            matches[0].push(range);
            matches[1].push(offset);
          }
        }
      }
      return matches;
    };

    /**
     * Resolves a group of selectors with token matching
     * @param selectorGroup - A group of CHSS selectors.
     */
    const matchGroupWithTokens = (selectorGroup:ParsedSelector[]) => Promise.all(selectorGroup.map(parsed => tokenOnlyMatch(parsed).then(([r,o]) => [r,parsed.specificity,o,parsed.pseudo] as FullMatch)));

    /**
     * For Selectors with combinators, we transform them into CSS to match against or document DOM.
     * @param selectorGroup - A group of selectors
     */
    const matchGroupWithDOM = async(selectorGroup:ParsedSelector[]) => {
      const dom = doc? this.doms.get(doc.uri.toString()):undefined;
      if (!dom) return [];
      const selectorGroups = [[]] as ParsedSelector[][];
      for (const pSelect of selectorGroup){
        const currentGroup = selectorGroups.at(-1)!;
        const nextOperator = pSelect.combinator;
        if (nextOperator && nextOperator === ',') selectorGroups.push([]);
        currentGroup.push(pSelect);
      }
      const finalSelectors = [] as string[];
      const finalParsed = [] as ParsedSelector[];
      for (const group of selectorGroups){
        let accumulator = ['div'] as string[];
        //Turning the selector into CSS
        for (const element of group) accumulator = dom.selectorToCSS(element,accumulator,element.regexp?(await tokenOnlyMatch(element))[1]:undefined,await this.getNotMatches(element, tokenOject, insensitive, doc),insensitive);
        finalSelectors.push(accumulator.join(', '));
        //The last selector in the group will have the highest specificity, which will be used to resolve conflicts.
        finalParsed.push(group.at(-1)!);
      }
      //Here, we get the actual token ranges, translated from the attributes encoded in the DOM nodes.
      return finalSelectors.map((fn, i) => ((mp = dom.matchesFromCSS(fn)) => [mp[0], finalParsed[i].specificity, mp[1], finalParsed[i].pseudo] as FullMatch)());
    };

    // We only need the DOM for complex selectors.
    if (complex && this.doms.has(doc?.uri.toString() ?? '')) return matchGroupWithDOM(selectors);
    return matchGroupWithTokens(selectors);
  }

  /**
   * For the :not() matches, the only data we need are the match offsets.
   * @param element - The selector we want :not() offsets for
   * @param tokens - The tokens of the document
   * @param insensitive - if true, name matches are case insensitive.
   * @param doc - the current text document.
   * @returns An array of offsets
   */
  private async getNotMatches(element:ParsedSelector, tokens:TokenCollection, insensitive?:boolean, doc?:TextDocument) {
    return element.notSelectors.length ? (await Promise.all(element.notSelectors.map(sels => this.selectorsToMatches(sels, isCompound(sels), tokens, insensitive, doc)))).flat().flatMap(p => p[2]) : [];
  }

  /**
   * Convert CSS properties into a style object useable with TextDecorationOptions  
   * Also outputs any TinyColor colorActions that may be defined for a property.
   * @param rules - A list of css properties and values
   */
  private parseRuleProperties(rules:string[]) {
    const ruleObj = {} as Record<string,string>;
    const cMap= new Map<string,[ColorAction,string]>();
    for (const r of rules) {
      const [_, name, value] = [...r.match(/^([^:]+):(.*)$/) ?? [void 0]].map(s => s?.trim());
      if (name && value) {
        //removing quotes.
        const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
        if (colorMods.some(m => value.startsWith(`${m}(`))) {
          //We parse the name and argument for the color transformation so they can be used directly.
          const [mode, arg] = value.split(/\(|\)/gm).map(s => s.trim());
          cMap.set(name, [mode as ColorAction, arg]);
        }
        //converting css kebab-case to camelCase.
        else ruleObj[name.replaceAll(/-(\w)/gm, a => a[1].toUpperCase())] = unquoted;
      }
    }
    return [cMap,ruleObj] as const;
  }

  private applyColorActions(colorActions:Map<string, [ColorAction,string]>, match:ChssMatch, style:Record<string, string>) {
    for (const [name, [action, args]] of colorActions.entries()) {
      // Random is already taken care of.
      if (action === 'random') continue;
      if (!(name in match.style)) continue;

      const colorIdent = [match.style[name], action, args].join('-');
      //If we already know what color the transformation will result in, we just give back the cached result.
      if (this.colorMap.has(colorIdent)) {
        style[name] = this.colorMap.get(colorIdent)!;
        continue;
      }

      const oldCol = color(match.style[name]);
      //Skipping broken rules.
      if (!oldCol.isValid()) continue;
      //Applying the tinyColor transformation.
      const newCol = oldCol[action](args ? parseInt(args, 10) : undefined as never);
      if (newCol.isValid()) {
        const hexa = newCol.toHex8String();
        //caching our result.
        this.colorMap.set(colorIdent, hexa);
        style[name] = hexa;
      }
    }
  }
}