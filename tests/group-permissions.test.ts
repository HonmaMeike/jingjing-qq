import { describe, expect, it } from 'vitest';
import { isGroupChatAllowed } from '../electron/services/chat-shared';

describe('群聊开关与白名单', () => {
  it('off 关闭全部群聊', () => {
    expect(isGroupChatAllowed({ groupChatMode: 'off', groupWhitelist: ['123'] }, '123')).toBe(false);
  });
  it('whitelist 只允许列出的群', () => {
    expect(isGroupChatAllowed({ groupChatMode: 'whitelist', groupWhitelist: ['123'] }, '123')).toBe(true);
    expect(isGroupChatAllowed({ groupChatMode: 'whitelist', groupWhitelist: ['123'] }, '456')).toBe(false);
    expect(isGroupChatAllowed({ groupChatMode: 'whitelist', groupWhitelist: [] }, '123')).toBe(false);
  });
  it('all 允许所有群', () => {
    expect(isGroupChatAllowed({ groupChatMode: 'all', groupWhitelist: [] }, '999')).toBe(true);
  });
  it('旧配置没有 mode 时按白名单处理', () => {
    expect(isGroupChatAllowed({ groupWhitelist: ['123'] }, '123')).toBe(true);
    expect(isGroupChatAllowed({ groupWhitelist: ['123'] }, '456')).toBe(false);
  });
});
