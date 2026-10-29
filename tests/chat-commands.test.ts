import { describe, expect, it } from 'vitest';
import { parseChatCommand } from '../electron/services/chat-commands';

describe('聊天命令解析', () => {
  it('识别好感命令', () => {
    for (const text of ['好感', '好感度', '你对我的好感度', '对我的好感度', '鲸鲸，你对我的好感度？', '@鲸鲸 好感档案']) {
      expect(parseChatCommand(text)).toEqual({ kind: 'affection' });
    }
  });
  it('识别画图/视频/唱歌', () => {
    expect(parseChatCommand('画 一只蓝鲸在吃白饭')).toEqual({ kind: 'image', prompt: '一只蓝鲸在吃白饭' });
    expect(parseChatCommand('帮我画：雨夜和海')).toEqual({ kind: 'image', prompt: '雨夜和海' });
    expect(parseChatCommand('生成视频 蓝鲸跃出海面')).toEqual({ kind: 'video', prompt: '蓝鲸跃出海面' });
    expect(parseChatCommand('唱首歌')).toEqual({ kind: 'music', query: '' });
    expect(parseChatCommand('唱《起风了》')).toMatchObject({ kind: 'music', title: '起风了' });
    expect(parseChatCommand('唱一首 夜空中最亮的星')).toMatchObject({ kind: 'music' });
  });
  it('缺少描述时返回帮助', () => {
    expect(parseChatCommand('画')).toEqual({ kind: 'help', tool: 'image' });
    expect(parseChatCommand('视频')).toEqual({ kind: 'help', tool: 'video' });
  });
  it('普通聊天不误判', () => {
    expect(parseChatCommand('今天好累')).toBeNull();
    expect(parseChatCommand('我想听你说话')).toBeNull();
  });
});
