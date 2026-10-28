import { expect, test } from '@playwright/test';
import { ComposePage } from './compose.page';
import type { MatchingQuestion } from '../question-bank/matching';

// 同一抽屉保留先前选题；通过实际DOM重绘复现第二次添加时的重复“取消添加”。
for (const wrongTarget of [false, true]) {
  test(`按原题ID检查当前题卡，其他题的取消按钮不能代替目标（错误更新=${wrongTarget}）`, async ({ page }) => {
    const sources = ['9007199254740993', '9007199254740995', '9007199254740997'].map(id => ({
      id, question: `相同前缀 ${id}`, questionScore: 2, options: [], subQuestions: [],
    } satisfies MatchingQuestion));
    await page.route('https://bmtk.test/**', async route => {
      if (new URL(route.request().url()).pathname.endsWith('/qrQuestionEntity/getByCatalogForProject')) {
        await route.fulfill({ json: { code: 'E200', data: { records: sources } } });
        return;
      }
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <button id="open">添加题目</button>
        <script>
          const sources=${JSON.stringify(sources)};
          const selected=new Set([sources[0].id]);
          document.querySelector('#open').onclick=async()=>{
            await fetch('/api/qrQuestionEntity/getByCatalogForProject',{method:'POST'});
            const drawer=document.createElement('section');drawer.className='ant-drawer-content';
            function render(){
              drawer.innerHTML='<h2>添加题目</h2><button aria-label="关闭">×</button>'+sources.map(q=>
                '<div class="question-card"><div data-confidential-target-type="QUESTION" data-confidential-target-id="'+q.id+'">'+q.question+'</div><footer><button data-id="'+q.id+'">'+(selected.has(q.id)?'取消添加':'加入试卷')+'</button></footer></div>'
              ).join('');
              drawer.querySelector('[aria-label="关闭"]').onclick=()=>drawer.remove();
              drawer.querySelectorAll('[data-id]').forEach(button=>button.onclick=()=>{
                if (!${wrongTarget}) selected.add(button.dataset.id);
                render();
              });
            }
            render();document.body.append(drawer);
          };
        </script>` });
    });
    await page.goto('https://bmtk.test/compose');
    const compose = new ComposePage(page);
    if (wrongTarget) {
      // 把超时限于受控负例，不改变生产业务等待。
      test.setTimeout(15_000);
      await expect(compose.addQuestion(sources[1], sources[1].question)).rejects.toThrow(/取消添加/);
      await expect(page.locator(`[data-confidential-target-id="${sources[1].id}"]`).locator('..')
        .getByRole('button', { name: '加入试卷', exact: true })).toBeVisible();
    } else {
      await compose.addQuestion(sources[1], sources[1].question);
      await compose.addQuestion(sources[2], '相同前缀');
      await expect(page.locator('.ant-drawer-content')).toHaveCount(0);
    }
  });
}
