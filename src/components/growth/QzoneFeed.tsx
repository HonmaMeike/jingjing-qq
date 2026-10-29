import { AlertTriangle, Globe, Loader2, Settings2, Sparkles } from 'lucide-react';
import type { AppSettings, QzonePost } from '@shared/types';
import { Avatar, Badge, Button, Card, CardBody, CardHead, EmptyState, Input, Toggle } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import MediaImage from '@/components/growth/MediaImage';
import { qzoneVisibilityLabel } from '@/components/growth/meta';

interface Props {
  posts: QzonePost[];
  loading: boolean;
  error: string | null;
  generating: boolean;
  notice: string | null;
  prompt: string;
  autoPost: boolean;
  autonomy: AppSettings['autonomy'];
  personaName: string;
  personaAvatar?: string;
  onPromptChange: (value: string) => void;
  onAutoPostChange: (value: boolean) => void;
  onGenerate: () => void;
  onRetry: () => void;
}

const STATUS_META: Record<QzonePost['status'], { label: string; tone: 'warning' | 'success' | 'danger' }> = {
  draft: { label: '草稿', tone: 'warning' },
  posted: { label: '已发布', tone: 'success' },
  failed: { label: '发布失败', tone: 'danger' },
};

export default function QzoneFeed(props: Props) {
  const {
    posts, loading, error, generating, notice, prompt, autoPost, autonomy, personaName, personaAvatar,
    onPromptChange, onAutoPostChange, onGenerate, onRetry,
  } = props;

  return (
    <div className="gro-qzone">
      <div className="gro-qzone__main">
        <Card className="gro-compose">
          <CardHead
            title={<><span className="gro-mini__icon is-violet"><Globe size={14} /></span>写一条说说</>}
            desc="她会用自己的语气写一条空间动态，可以配图、可以只存草稿。"
            extra={<Badge tone={autoPost ? 'success' : 'default'}>{autoPost ? '生成后自动发布' : '只生成草稿'}</Badge>}
          />
          <CardBody>
            <div className="gro-compose__row">
              <Input
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder="想让她念叨点什么？留空就自由发挥…"
                aria-label="QQ 空间说说主题"
                maxLength={120}
              />
              <Button variant="primary" icon={<Sparkles size={15} />} loading={generating} onClick={onGenerate}>
                生成说说
              </Button>
            </div>
            <div className="gro-compose__foot">
              <label className="gro-switch">
                <Toggle checked={autoPost} onChange={onAutoPostChange} label="生成后自动发布" />
                <span>生成后自动发布</span>
              </label>
              <span className="dim text-xs">自动发布需要 QQ 空间已登录；失败时草稿会留在本地。</span>
            </div>
            {notice && (
              <div className="callout callout--warning" style={{ marginTop: 12 }}>
                <AlertTriangle size={15} className="callout__icon" />
                <span>{notice}</span>
              </div>
            )}
          </CardBody>
        </Card>

        {!autonomy.qzoneEnabled && (
          <div className="callout callout--brand gro-callout">
            <Settings2 size={15} className="callout__icon" />
            <span>自动发说说已在「设置 · 自主生活」里关闭。你仍然可以手动生成，但鲸鲸不会自己定时发。</span>
          </div>
        )}

        {error && (
          <div className="gro-inline-error">
            <AlertTriangle size={13} />
            <span className="flex-1">{error}</span>
            <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>
          </div>
        )}

        {loading && posts.length === 0 ? (
          <div className="gro-feed-skeleton">
            {[0, 1].map((index) => (
              <Card key={index} className="gro-post">
                <div style={{ padding: 18 }}>
                  <div className="skeleton" style={{ width: 42, height: 42, borderRadius: '50%' }} />
                  <div className="skeleton" style={{ height: 12, width: '40%', marginTop: 14 }} />
                  <div className="skeleton" style={{ height: 11, width: '92%', marginTop: 16 }} />
                  <div className="skeleton" style={{ height: 11, width: '78%', marginTop: 9 }} />
                </div>
              </Card>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <Card className="gro-section-card">
            <EmptyState
              icon={<Globe size={23} />}
              title="空间里还没有动静"
              desc="让她写第一条说说吧。可以聊聊最近的心情、今天的天气，或者刚学到的冷知识。"
              action={<Button variant="primary" icon={<Sparkles size={15} />} loading={generating} onClick={onGenerate}>生成第一条说说</Button>}
            />
          </Card>
        ) : (
          <div className="gro-feed">
            {posts.map((post) => (
              <Card key={post.id} className="gro-post" hover>
                <div className="gro-post__head">
                  <Avatar src={personaAvatar} name={personaName} size="md" ring />
                  <div className="gro-post__identity">
                    <div className="gro-post__name">{personaName}</div>
                    <div className="gro-post__time">
                      {relativeTime(post.createdAt)} · {qzoneVisibilityLabel(post.visibility)}
                      {post.tid && <span className="gro-post__tid"> · 空间 #{post.tid}</span>}
                    </div>
                  </div>
                  <Badge tone={STATUS_META[post.status].tone}>{STATUS_META[post.status].label}</Badge>
                </div>

                <p className="gro-post__content">{post.content}</p>

                {post.images.length > 0 && (
                  <div className={post.images.length === 1 ? 'gro-post__images is-single' : 'gro-post__images'}>
                    {post.images.map((image, index) => (
                      <MediaImage key={`${index}-${image.slice(0, 12)}`} src={image} alt={post.content.slice(0, 24)} className="gro-post__image" />
                    ))}
                  </div>
                )}

                {post.error && (
                  <div className="gro-post__error">
                    <AlertTriangle size={13} />{post.error}
                  </div>
                )}

                <div className="gro-post__foot">
                  <span className="dim text-xs">{post.status === 'posted' ? '已同步到 QQ 空间' : post.status === 'failed' ? '发布失败，内容保留在本地' : '本地草稿 · 等待发布'}</span>
                  <span className="dim text-xs mono">{formatDateTime(post.createdAt)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="gro-qzone__side">
        <CardHead title={<><span className="gro-mini__icon is-amber"><Settings2 size={14} /></span>发布设置</>} desc="来自「设置 · 自主生活」" />
        <CardBody>
          <div className="gro-setting"><span>可见范围</span><b>{qzoneVisibilityLabel(autonomy.qzoneVisibility)}</b></div>
          <div className="gro-setting"><span>每日发布</span><b>{String(autonomy.qzoneHour).padStart(2, '0')}:00 之后</b></div>
          <div className="gro-setting"><span>最小间隔</span><b>{autonomy.qzoneMinGapHours} 小时</b></div>
          <div className="gro-setting"><span>自动发布</span><b>{autonomy.qzoneEnabled ? '已开启' : '已关闭'}</b></div>
          <div className="gro-qzone__note">
            这些节奏控制了鲸鲸发动态的频率，避免她刷屏。想调整可以去设置页，不需要在这里改。
          </div>
          <div className="gro-qzone__tip">
            <Loader2 size={13} className={generating ? 'spin' : ''} />
            <span>{generating ? '她正在想文案、挑配图…' : '生成通常需要几秒，失败会保留草稿。'}</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
