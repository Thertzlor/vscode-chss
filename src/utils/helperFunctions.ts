import {Range,Position} from 'vscode';
import type {Pseudo} from './chssParser';
export type RangeIdentifier = ReturnType<typeof rangeToIdentifier>;
export const rangeToIdentifier = ({start,end}:Range,pseudo?:Pseudo) => `${start.line}|${start.character}|${end.line}|${end.character}${pseudo?`|${pseudo}` as const:'' as const}` as const;

export const identifierToRange = (ident:RangeIdentifier) => (([sl,sc,el,eC]=ident.split('|').map((n,i) => (i ===4?0: parseInt(n,10)))) => new Range(new Position(sl,sc),new Position(el,eC)))();