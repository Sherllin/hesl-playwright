import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export interface ExamQuestion { stem: string; options?: string[]; answer: string; formula?: string; image?: string }
export interface QuestionSample { type: '单选题' | '简答题'; textInput: 'insertText'; stem: string; options?: string[]; answerIndexes?: number[]; answerText?: string }
interface Corpus { source: string; sourceSha256: string; answerOrigin: string; questions: ExamQuestion[] }
const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** 原题文复用；科学/语言专项是明确标注的测试扩展，不冒充原卷。 */
export function paperStyleExam() {
  const sources = ['349药学综合A卷22年', '2023-610药学基础查重'].map(file =>
    JSON.parse(readFileSync(path.join(fixtureDirectory, `${file}.json`), 'utf8')) as Corpus);
  const questions: ExamQuestion[] =
    sources.flatMap(c => c.questions);
  questions.push(
    { stem: '酶动力学：底物浓度为2 mmol/L，最大反应速率为100 nmol/min，米氏常数为2 mmol/L。依据下式计算初始反应速率v。',
      formula: String.raw`v=\frac{V_{\max}[S]}{K_m+[S]}`, answer: 'v=50 nmol/min。' },
    { stem: '药物按一级动力学消除，初始浓度为20 mg/L，消除速率常数k为0.2 min⁻¹。依据下式计算5 min后的药物浓度。',
      formula: String.raw`C(t)=C_0 e^{-kt}`, answer: 'C(5)=20/e，约7.36 mg/L。' },
    { stem: '实验测量值变换为下列根式函数。请给出函数的实数定义域，并计算x=3时的函数值。',
      formula: String.raw`f(x)=\sqrt{x+1}`, answer: '定义域x≥-1，f(3)=2。' },
    { stem: '图示为酶促反应初始速率与底物浓度的关系。请根据坐标轴和曲线估计Vmax与Km，并说明高浓度区曲线趋于平台的原因。',
      image: path.join(fixtureDirectory, 'enzyme-kinetics.png'),
      answer: 'Vmax为100 nmol/min，Km为2 mmol/L；高底物浓度下酶的活性中心趋于饱和。' },
    { stem: 'English / 中文：Explain why hemoglobin exhibits cooperative oxygen binding while myoglobin does not. 请比较两者的结构与功能。',
      answer: 'Hemoglobin has multiple interacting subunits; myoglobin is monomeric.' },
    { stem: 'Français：Décrivez le rôle de la température et du pH dans une réaction enzymatique. 请说明温度及pH对酶促反应的影响。',
      answer: 'La température et le pH influencent la conformation et l’activité de l’enzyme.' },
    { stem: '日本語：酵素の活性部位と基質の関係を説明してください。Русский：Объясните специфичность фермента. 请说明酶与底物的特异性。',
      answer: '酶活性部位的空间结构和化学基团决定底物识别及催化特异性。' },
  );
  const samples: QuestionSample[] = questions.map(q => ({ type: q.options ? '单选题' : '简答题',
    textInput: 'insertText', stem: q.stem, options: q.options,
    answerIndexes: q.options ? ['ABCD'.indexOf(q.answer)] : undefined,
    answerText: q.options ? undefined : q.answer }));
  const compact = (s: string) => s.replace(/\s+/g, '');
  const candidates = questions.flatMap(q => [q.stem, ...q.options ?? []]).map(compact);
  const markers = candidates.filter(v => v.length >= 10 && candidates.filter(c => c.includes(v)).length === 1);
  return { sources, questions, samples, markers };
}
