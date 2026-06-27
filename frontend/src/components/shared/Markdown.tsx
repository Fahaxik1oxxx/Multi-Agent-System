import { useMemo } from 'react';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch {
          // fallback
        }
      }
      return hljs.highlightAuto(code).value;
    },
  })
);

marked.use({
  gfm: true,
  breaks: true,
});

interface MarkdownProps {
  text: string;
}

export function Markdown({ text }: MarkdownProps) {
  const html = useMemo(() => {
    if (!text) return '';
    try {
      const raw = marked.parse(text) as string;
      // 为代码块添加复制按钮
      return raw.replace(
        /<pre><code class="hljs language-(\w*)">/g,
        (_, lang) =>
          `<div class="code-block"><div class="code-lang">${lang || 'code'}</div><button class="code-copy" onclick="(function(btn){const code=btn.parentElement.querySelector('code').textContent;navigator.clipboard.writeText(code).then(()=>{btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',2000)}).catch(()=>{});})(this)">复制</button><pre><code class="hljs language-${lang}">`
      );
    } catch {
      return `<pre><code>${text}</code></pre>`;
    }
  }, [text]);

  if (!text) return null;
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
