import {Range} from 'vscode';
import type {SymbolKind,Uri} from 'vscode';
import type {Pseudo} from './chssParser';
export type RangeIdentifier = ReturnType<typeof rangeToIdentifier>;
export type TokenKind = Lowercase<keyof typeof SymbolKind>|'parameter'|'type';

const rts = new WeakMap<Range,string>();
const str = new Map<string,Range>();

const timeChangeMap = new Map<string,number>();
const timeStyleMap = new Map<string,number>();

export const needsRestyled = (u?:Uri) => (timeChangeMap.get(u?.toString()??'') ?? 0) >= (timeStyleMap.get(u?.toString()??'') ?? 0);

export const setTimeStyled = (u?:Uri) => u && void timeStyleMap.set(u.toString(),Date.now());
export const setTimeChanged = (u?:Uri) => u && void timeChangeMap.set(u.toString(),Date.now());

export const setFreshStyle = () => timeStyleMap.clear();

export const mightMissProps = new Set(['typescript','javascript']);
export const accessors = new Map(([
  ['typescript',['.','?.','!.']],
  ['javascript',['.','?.']],
  ['lua',['.',':']]
] as any as [string,string[]]).map(([t,a]) => [t,new Set(a)]));

export const hasFields = new Set<TokenKind>(['class','property','variable','object','parameter','namespace']);
export const isField = new Set<TokenKind>(['property','method','function']);

export const rangeToIdentifier = (r:Range,pseudo?:Pseudo) => (!pseudo && rts.has(r)?rts.get(r)!:(({start,end} = r) => ((s=`${start.line}|${start.character}|${end.line}|${end.character}${pseudo?`|${pseudo}` as const:'' as const}` as const) => (!pseudo && rts.set(r,s) , s))())());

export const identifierToRange = (ident:RangeIdentifier) => (str.has(ident)?str.get(ident)!:(([sl,sc,el,eC]=ident.split('|').map((n,i) => (i === 4?0: parseInt(n,10)))) => ((r = new Range(sl,sc,el,eC)) => (str.set(ident,r),r))())());

export const debounce = <T extends (...args:any[])=>any>(callback:T, wait:number) => {
  let timeoutId:ReturnType<typeof setTimeout> |undefined;
  return (...args:Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), wait);
  };
};