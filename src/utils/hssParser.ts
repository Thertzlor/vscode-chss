import {TokenData} from './rangesByName';
import { Range } from 'vscode';

interface ParsedRule {type:string, specificity:number, name:string, modifiers:string[], scopes?:string[]}
interface HssRule  {selector: ParsedRule[], style:Record<string,string>}
interface HssMatch  {range:Range, style:Record<string,string>, parsed:ParsedRule}

function parseRule(selector:string):ParsedRule{
  const invalid = {specificity:0, name:'', type:'',modifiers:[]}
  if(/^\w+$/.test(selector))return {specificity:10, name:selector, type:'variable',modifiers:[]}; //simple variable: name
  if(/^\w+$/.test(selector.slice(1))){ 
    const sliced = selector.charAt(0)
    switch (sliced) {
      case '.': return {specificity:100, name:sliced, type:'class',modifiers:[]} //class: .name
      case '#':return {specificity:100, name:sliced, type:'function',modifiers:[]} //function: #name
      default: return invalid;
    }
  }
  if(selector.startsWith('[') && selector.indexOf(']') ===  selector.length-1) return {specificity:1, name:'', type:selector,modifiers:[]} // general type: [variable]
  if(selector.startsWith('[')){ // extended type with one or more modifiers: [variable]:readonly
    const modsplit = selector.split(':')
    const sel = modsplit.shift()?.slice(1,-1) ?? ''
    if(!modsplit.length || !sel || !sel.endsWith(']')) return invalid
    return {specificity:1+(modsplit.length*10), name:'', type:sel,modifiers:[]}
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
  const {specificity,name,type} = parseRule(ident)
  if(specificity === 0) return invalid;
  return {specificity:specificity+(10*splitMods.length), name, type,modifiers:splitMods}
}



export function parseHss(str:string){
  const res = [] as HssRule[]
  let skipNext = false
  for (const [i,v] of str.split(/[{}]/gm).map(s=>s.trim()).entries()) {
    const selector = i % 2 === 0;

    if(skipNext){skipNext = false; continue}
    if(selector && !v) {skipNext = true;continue}

    if(selector){
      const selectors = v.split(',').map(s=>s.trim()).filter(s=>s).map(s=> (parseRule(s))).filter(({specificity}) => specificity !== 0)
      if(!selectors.length){skipNext = true;continue}
      res.push({selector:selectors,style:{}})
    }
    else{
      if(!v){res.pop();continue}
      const rules = v.split(';').map(s=>s.trim()).filter(s=>s)
      if(!rules.length){res.pop();continue}
      const ruleObj = {} as Record<string,string>
      for (const r of rules) {
        const [name,value] = r.split(':');
        if(name && value) ruleObj[name]=value
      }
      res[res.length-1].style = ruleObj
    }
  }
  return res
}

export function processHss(rangeObject:Record<string, Set<TokenData>>,rules:HssRule[]):HssMatch[]{
  const matched:HssMatch[] = []
  for (const {selector,style} of rules) {
    for (const parsed of selector) {
      const target = 'variable'
      if(!(target in rangeObject)) continue;
      for (const {name,range,modifiers,type} of rangeObject[target]) {
        if((!parsed.name || parsed.name === name) && (!parsed.type || parsed.type === type) && (!parsed.modifiers.some(m=> !modifiers.includes(m))))
        matched.push({range,style, parsed})
      }
    }
  }
  return matched
}