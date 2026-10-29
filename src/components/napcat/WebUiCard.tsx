import React from 'react';
import { Globe, MonitorPlay, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHead, CopyButton, Modal, useToast } from '@/components/ui';
import { errMessage, maskSecret, withToken } from './utils';

interface WebUiCardProps {
  webuiUrl: string;
  webuiToken: string;
  installed: boolean;
}

export function WebUiCard({ webuiUrl, webuiToken, installed }: WebUiCardProps) {
  const toast = useToast();
  const [opening, setOpening] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const previewSrc = React.useMemo(() => withToken(webuiUrl, webuiToken), [webuiUrl, webuiToken]);

  const openBuiltin = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (!webuiUrl) { toast.warning('WebUI 暂不可用', '请先填写 WebUI 地址与 Token'); return; }
      setPreview(false);
      await api.napcat.openWebui(withToken(webuiUrl, webuiToken));
      toast.success('已打开 NapCat 内置窗口', 'WebUI 在独立内置窗口中运行，不会打开外部浏览器');
    } catch (error) {
      toast.error('打开 WebUI 失败', errMessage(error));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Card className="nc-card nc-webui">
      <CardHead
        title="内置 WebUI"
        desc="NapCat 官方管理界面，本地运行"
        icon={<Globe size={16} />}
        extra={<Badge tone={webuiUrl ? 'brand' : 'default'}>{webuiUrl ? '本地地址' : '未配置'}</Badge>}
      />
      <CardBody>
        <div className="nc-webui__url">
          <span className="mono truncate" title={webuiUrl}>{webuiUrl || '尚未配置 WebUI 地址'}</span>
          {webuiUrl && <CopyButton text={webuiUrl} label="复制" />}
        </div>
        <div className="nc-info-list nc-info-list--compact">
          <div><span>访问 Token</span><b className="mono">{maskSecret(webuiToken)}</b></div>
          <div><span>运行位置</span><b>仅本机 127.0.0.1</b></div>
        </div>
        <div className="nc-webui__actions">
          <Button variant="secondary" size="sm" icon={<MonitorPlay size={13} />} loading={opening} disabled={!installed} onClick={() => void openBuiltin()}>在内置窗口打开</Button>
          <Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} disabled={!webuiUrl} onClick={() => setPreview(true)}>页内预览</Button>
        </div>
        <p className="form-hint" style={{ marginTop: 9 }}>
          WebUI 由 NapCat 在本机提供，不走外部浏览器。若页内预览被上游安全策略拦截，请使用「内置窗口打开」。
        </p>
      </CardBody>

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        wide
        title="NapCat WebUI · 页内预览"
        desc="本地管理界面，登录与配置都在鲸鲸窗口内完成"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPreview(false)}>关闭</Button>
            <Button variant="primary" icon={<MonitorPlay size={14} />} loading={opening} onClick={() => void openBuiltin()}>改用内置窗口打开</Button>
          </>
        )}
      >
        <div className="nc-webui__frame">
          {previewSrc ? (
            React.createElement('webview' as unknown as React.ElementType, {
              src: previewSrc,
              title: 'NapCat WebUI',
              className: 'nc-webui__iframe',
              style: { width: '100%', height: 'min(72vh, 760px)', border: 'none', display: 'block', background: '#0b1522' },
              allowpopups: 'true',
            })
          ) : (
            <div className="nc-webui__empty">尚未配置 WebUI 地址，请先在「连接」配置中填写。</div>
          )}
        </div>
      </Modal>
    </Card>
  );
}
