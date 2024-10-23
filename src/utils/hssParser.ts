import {type TokenData} from './rangesByName';
import { Range ,languages, type TextDocument, RelativePattern, type Uri } from 'vscode';

type MatchType = "endsWith"|"startsWith"|"includes"|"match"
interface ParsedRule {type:string, specificity:number, name:string, modifiers:string[], scopes?:string[],match?:MatchType,regexp?:RegExp}
interface HssRule {selector: ParsedRule[], style:Record<string,string>, scope?:string}
interface HssMatch {range:Range, style:Record<string,string>, specificity:number}

export class HssParser{
  constructor(
    private baseUri?:Uri
  ){}
  private parseSelector(selector:string):ParsedRule{
  const invalid = {specificity:0, name:'', type:'',modifiers:[]}
  if(selector === '*') return {specificity:1, name:'', type:'*',modifiers:[]}
  if(/^\w+$/.test(selector))return {specificity:50, name:selector, type:'*',modifiers:[]}; //simple variable: name
  if(/^\w+$/.test(selector.slice(1))){ 
    const sliced = selector.charAt(0)
    switch (sliced) {
      case '#':return {specificity:100, name:selector.slice(1), type:'variable',modifiers:[]} //function: #name
      case '.': return {specificity:100, name:selector.slice(1), type:'function',modifiers:[]} //class: .name
      default: return invalid;
    }
  }
  if(selector.startsWith('<') && selector.endsWith('>')){
    let [operator,value,manualType] = selector.slice(1,-1).split('=').map(s=>s.trim())
    const ops:Record<string,MatchType|undefined> = {"^":"startsWith","*":'includes',"$":"endsWith"}
    const mType:MatchType = ops[operator] ?? "match" 
    const matchSpecs = {match:40,startsWith:30,endsWith:30,includes:20}
    if (value===undefined) value = operator
    if(mType === "match" && !value?.includes('*') && !/^"\/.+\/i?"$/.test(value)) return invalid;
    const insense = value.slice(0,-1).endsWith('/i')
    let regexp=mType === "match"?new RegExp(value.startsWith('"') && value.endsWith('"')?value.slice(2,insense?-3:-2):value.replace('*','.*'),insense && value.startsWith('"')?"i":undefined ):undefined

return {specificity:matchSpecs[mType], name:value, type:manualType||'*',modifiers:[],regexp,match:mType}
  }
  if(selector.startsWith('[') && selector.endsWith(']')) return {specificity:2, name:'', type:selector.slice(1,-1),modifiers:[]} // general type: [variable]
  if(selector.startsWith('[')){ // extended type with one or more modifiers: [variable]:readonly
    const modifiers = selector.split(':')
    const sel = modifiers.shift() ?? ''
    if(!modifiers.length || !sel || !sel.endsWith(']')) return invalid
    return {specificity:10+(modifiers.length*10), name:'', type:sel.slice(1,-1),modifiers}
  }
  if(selector.includes('[') && selector.includes(']')){ //compound: name[variable]:readonly
    if(!/\w/.test(selector.charAt(0))) return invalid
    const splitUp = selector.split(/\[|\]/gm);
    const name = splitUp.shift()!;
    const type = splitUp.shift();
    const mods = splitUp.shift();
    if(!type) return invalid;
    if(!mods) return  {specificity:11, name, type,modifiers:[]}
    const splitMods = mods.split(':');
    return {specificity:11+(10*splitMods.length), name, type,modifiers:splitMods}
  }
  if(selector.includes('[') || selector.includes(']')) return invalid
  const splitMods = selector.split(':');
  const ident = splitMods.shift();
  if(!ident) return invalid;
  const {specificity,name,type} = this.parseSelector(ident)
  if(specificity === 0) return invalid;
  return {specificity:specificity+(10*splitMods.length), name, type,modifiers:splitMods}
}


  public parseHss(str:string){
  const res = [] as HssRule[]
  let skipNext = false
  let currentScope:string|undefined
  for (const [i,v] of str.replace(/{\s*}/gm,'{empty}').split(/[{}]/gm).map(s=>s.trim()).entries()) {
    const selector = (i + (currentScope?1:0)) % 2 === 0;
    if(currentScope && !v){currentScope = undefined;continue}
    if(skipNext){skipNext = false; continue}
    if(selector && !v ) {skipNext = true;continue}
    if(selector){
      if(v.startsWith('scope(')){
        currentScope = v.match(/.*\((.*)\)$/)?.[1].trim() || '???'
        continue
      }
      const selectors = v.split(',').map(s=>s.trim()).filter(s=>s).map(s=> (this.parseSelector(s))).filter(({specificity}) => specificity !== 0)
      if(!selectors.length){skipNext = true;continue}
      const protoRule:HssRule = {selector:selectors,style:{}}
      if(currentScope)protoRule.scope = currentScope
      res.push(protoRule)
    }
    else{
      if(!v || v === "empty"){res.pop();continue}
      const rules = v.split(';').map(s=>s.trim()).filter(s=>s)
      if(!rules.length){res.pop();continue}
      const ruleObj = {} as Record<string,string>
      for (const r of rules) {
        const [name,value] = r.split(':');
        if(name && value) {
          ruleObj[name.trim().replace(/-(\w)/gm,a => a[1].toUpperCase())]=value.trim()}
      }
      res[res.length-1].style = ruleObj
    }
  }
  return res
}

private matchName(name:string,type:MatchType,val:string,reg?:RegExp){
  if (reg) return reg.test(name);
  return !!name[type](val)
}

  public processHss(rangeObject:Record<string, Set<TokenData>>,rules:HssRule[],doc?:TextDocument):HssMatch[]{
  const matched:HssMatch[] = []
  const combined = new Map<string,HssMatch>()
  for (const {selector,style,scope} of rules) {
    if(scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue
    for (const parsed of selector) {
      const targetType = parsed.type
      if(!(targetType in rangeObject) && targetType !== '*') continue;
      for (const {name,range,modifiers} of (targetType === '*'?Object.keys(rangeObject).flatMap(k=>[...rangeObject[k]]):rangeObject[targetType])) {
        // console.log({parsed,matched : parsed.match && this.matchName(name,parsed.match, parsed.name,parsed.regexp)})
        if((!parsed.name || parsed.name === name || (parsed.match && this.matchName(name,parsed.match, parsed.name,parsed.regexp))) && (!parsed.modifiers.some(m=> !modifiers.includes(m))))
        matched.push({range,style,specificity:parsed.specificity})
      }
    }
  }  

  for ( const m of matched){
    const {range} =m;
    const rangeIdent = [range.start.line,range.start.character,range.end.line,range.end.character].join('|')
    if(!combined.has(rangeIdent)){
      combined.set(rangeIdent, m)
    }else {
      const current = combined.get(rangeIdent)!
      const [sA, sB] = [current,m].map(s=>s.specificity)
      combined.set(rangeIdent,{range:current.range, style:sA<=sB?{...current.style, ...m.style}:{...m.style, ...current.style} , specificity:Math.max(sA,sB)})
    }
  }

 
  return  [...combined.values()]
}

}