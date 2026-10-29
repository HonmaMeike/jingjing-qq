export type ChatCommand =
  | { kind: 'affection' }
  | { kind: 'image'; prompt: string }
  | { kind: 'video'; prompt: string }
  | { kind: 'music'; query: string; title?: string }
  | { kind: 'fetch'; url: string }
  | { kind: 'help'; tool: 'image' | 'video' | 'music' };

function clean(text: string): string {
  return text.trim()
    .replace(/^[@＠]\S+\s*/, '')
    .replace(/^(?:鲸鲸|小鲸鱼|鲸宝)[，,。.!！\s]*/, '')
    .trim();
}

export function parseChatCommand(raw: string): ChatCommand | null {
  const text = clean(raw);
  if (!text) return null;
  if (/^(?:你?对我的)?好感(?:度)?(?:是多少|多少|怎么样|呢|呀|啊|？|\?)?$/.test(text) || /^(?:好感档案|好感度档案|关系档案)$/.test(text)) {
    return { kind: 'affection' };
  }
  const fetch = text.match(/^(?:抓取|读一下|看看这个网页|打开并总结|总结网页)[\s:：]*(https?:\/\/[^\s]+)$/i);
  if (fetch) return { kind: 'fetch', url: fetch[1] };
  const image = text.match(/^(?:画|画图|画一张|画个|帮我画|给我画|生成图片|生成一张|来张图|来一张图|来张|来一张)(?:一张|一个|个)?[\s:：]*(.*)$/);
  if (image) return image[1].trim() ? { kind: 'image', prompt: image[1].trim() } : { kind: 'help', tool: 'image' };
  const video = text.match(/^(?:视频|生成视频|做个视频|来段视频|来一个视频|来段|生成一段视频)[\s:：]*(.*)$/);
  if (video) return video[1].trim() ? { kind: 'video', prompt: video[1].trim() } : { kind: 'help', tool: 'video' };
  const music = text.match(/^(?:(?:你|能不能|可以|麻烦|请|给我|帮我|来)?\s*)(?:唱|唱歌|唱首歌|唱一首歌|唱两句|哼一首|哼两句|来首歌|给我唱|唱首|唱一个|来一首|来一首歌|想听你唱)(?:歌)?[\s:：]*(.*)$/);
  if (music) {
    const rest = music[1].trim().replace(/^(?:首歌|首|一首歌|一首|个歌|歌)[\s:：]*/, '').trim();
    if (!rest || /^(?:吧|呗|呀|啊|随便|随机|一首|歌)?[。.!！~～\s]*$/.test(rest)) return { kind: 'music', query: '' };
    const titleMatch = rest.match(/《([^》]+)》/);
    const title = titleMatch?.[1]?.trim();
    const query = rest.replace(/^唱|^一首|^歌|^《.*?》|^[:：]\s*/g, '').trim() || rest;
    return { kind: 'music', query: title ?? query, title };
  }
  return null;
}
