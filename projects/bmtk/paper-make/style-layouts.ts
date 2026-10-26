/** 迁自 REMOTE-19.3；服务端 paperSize=0 为横向两栏，1 为纵向一栏。 */
export const PAPER_STYLE_LAYOUTS = [
  { label: '一栏-单面', paperSize: 1, printSetup: 1 },
  { label: '一栏-双面', paperSize: 1, printSetup: 2 },
  { label: '两栏-单面', paperSize: 0, printSetup: 1 },
  { label: '两栏-双面', paperSize: 0, printSetup: 2 },
] as const;
export interface PaperStyleLayout { label: string; paperSize: 0 | 1; printSetup: 1 | 2 }
