import { describe, expect, it } from 'vitest';
import { routeIntent } from '../electron/services/intent-router';

describe('自然语言意图路由', () => {
  it('识别画画与视频', () => {
    expect(routeIntent('给我画一只在吃白饭的鲸鱼')).toMatchObject({ kind: 'command', command: { kind: 'image' } });
    expect(routeIntent('帮我拍一段深海视频')).toMatchObject({ kind: 'command', command: { kind: 'video' } });
  });
  it('识别唱歌与钱包', () => {
    expect(routeIntent('来一首安静的歌')).toMatchObject({ kind: 'command', command: { kind: 'music' } });
    expect(routeIntent('你还有多少钱')).toEqual({ kind: 'balance' });
  });
  it('普通聊天不误判', () => {
    expect(routeIntent('今天有点累')).toEqual({ kind: 'none' });
  });
});
