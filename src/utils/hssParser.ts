import {type TokenData} from './rangesByName';
import { Range ,languages, type TextDocument, RelativePattern, type Uri } from 'vscode';

interface ParsedRule {type:string, specificity:number, name:string, modifiers:string[], scopes?:string[]}
interface HssRule {selector: ParsedRule[], style:Record<string,string>, scope?:string}
interface HssMatch {range:Range, style:Record<string,string>, specificity:number}

export class HssParser{
  constructor(
    private baseUri?:Uri
  ){}

  private parseRule(selector:string):ParsedRule{
  const invalid = {specificity:0, name:'', type:'',modifiers:[]}
  if(/^\w+$/.test(selector))return {specificity:10, name:selector, type:'variable',modifiers:[]}; //simple variable: name
  if(/^\w+$/.test(selector.slice(1))){ 
    const sliced = selector.charAt(0)
    switch (sliced) {
      case '.': return {specificity:100, name:selector.slice(1), type:'class',modifiers:[]} //class: .name
      case '#':return {specificity:100, name:selector.slice(1), type:'function',modifiers:[]} //function: #name
      default: return invalid;
    }
  }
  if(selector.startsWith('[') && selector.indexOf(']') ===  selector.length-1) return {specificity:1, name:'', type:selector.slice(1,-1),modifiers:[]} // general type: [variable]
  if(selector.startsWith('[')){ // extended type with one or more modifiers: [variable]:readonly
    const modifiers = selector.split(':')
    const sel = modifiers.shift() ?? ''
    if(!modifiers.length || !sel || !sel.endsWith(']')) return invalid
    return {specificity:1+(modifiers.length*10), name:'', type:sel.slice(1,-1),modifiers}
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
  const {specificity,name,type} = this.parseRule(ident)
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
      if(v.startsWith('@scope')){
        currentScope = v.match(/.*\((.*)\)$/)?.[1].trim() || '???'
        continue
      }
      const selectors = v.split(',').map(s=>s.trim()).filter(s=>s).map(s=> (this.parseRule(s))).filter(({specificity}) => specificity !== 0)
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
          ruleObj[name.trim()]=value.trim()}
      }
      res[res.length-1].style = ruleObj
    }
  }
  return res
}


  public processHss(rangeObject:Record<string, Set<TokenData>>,rules:HssRule[],doc?:TextDocument):HssMatch[]{
  const matched:HssMatch[] = []
  const combined = new Map<string,HssMatch>()
  console.log(JSON.stringify(rules,undefined,2))
  for (const {selector,style,scope} of rules) {
    if(scope && (!doc || !languages.match({pattern: this.baseUri? new RelativePattern(this.baseUri,scope):scope}, doc))) continue
    for (const parsed of selector) {
      const target = parsed.type
      if(!(target in rangeObject)) continue;
      for (const {name,range,modifiers} of rangeObject[target]) {
        if((!parsed.name || parsed.name === name) && (!parsed.modifiers.some(m=> !modifiers.includes(m))))
        matched.push({range,style,specificity:parsed.specificity})
      }
    }
  }
  

  for ( const m of matched.sort((a,b) => a.specificity > b.specificity?1:-1)){
    const {range} =m;
    const rangeIdent = [range.start.line,range.start.character,range.end.line,range.end.character].join('|')
    if(!combined.has(rangeIdent)){
      combined.set(rangeIdent, m)
    }else {
      const current = combined.get(rangeIdent)!
      combined.set(rangeIdent,{range:current.range, style:{...current.style, ...m.style} , specificity:1})
    }
  }

 
  return  [...combined.values()]
}

}