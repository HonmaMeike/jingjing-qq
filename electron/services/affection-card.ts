import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface AffectionCardInput {
  userName: string;
  personaName: string;
  scene: string;
  affinity: number;
  trust: number;
  familiarity: number;
  intimacy: number;
  respect: number;
  interactions: number;
  streakDays: number;
  firstMetAt?: string;
  note?: string;
  outputPath: string;
}

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$raw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:JJ_AFFECTION_JSON))
$d = $raw | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
$w = 900; $h = 560
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$rect = New-Object System.Drawing.Rectangle(0,0,$w,$h)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255,8,22,40), [System.Drawing.Color]::FromArgb(255,15,42,70), 25)
$g.FillRectangle($bg, $rect)
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,100,230,255))
$soft = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,169,193,217))
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,238,247,255))
$pink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,255,143,206))
$fontTitle = New-Object System.Drawing.Font('Microsoft YaHei UI', 30, [System.Drawing.FontStyle]::Bold)
$fontName = New-Object System.Drawing.Font('Microsoft YaHei UI', 22, [System.Drawing.FontStyle]::Bold)
$font = New-Object System.Drawing.Font('Microsoft YaHei UI', 14)
$fontSmall = New-Object System.Drawing.Font('Microsoft YaHei UI', 11)
$g.DrawString('好感档案', $fontTitle, $accent, 48, 38)
$g.DrawString('她记得每一次靠近', $fontSmall, $soft, 52, 94)
$g.DrawString($d.userName, $fontName, $white, 48, 150)
$g.DrawString('× ' + $d.personaName + ' · ' + $d.scene, $font, $pink, 52, 192)
$g.DrawString('互动 ' + $d.interactions + ' 次 · 连续 ' + $d.streakDays + ' 天', $fontSmall, $soft, 52, 228)
$labels = @('好感','信任','熟悉','亲密','尊重')
$values = @([int]$d.affinity,[int]$d.trust,[int]$d.familiarity,[int]$d.intimacy,[int]$d.respect)
$y = 292
for ($i = 0; $i -lt 5; $i++) {
  $v = [Math]::Max(0, [Math]::Min(100, $values[$i]))
  $g.DrawString($labels[$i], $font, $soft, 52, $y)
  $barBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70,255,255,255))
  $g.FillRectangle($barBg, 150, $y + 5, 560, 16)
  $bar = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,100,230,255))
  $g.FillRectangle($bar, 150, $y + 5, [int](560 * $v / 100), 16)
  $g.DrawString(([string]$v), $fontSmall, $white, 728, $y)
  $y += 42
}
$note = if ($d.note) { [string]$d.note } else { '数据来自你们真实聊过后留下的关系档案。' }
$g.DrawString($note, $fontSmall, $soft, 52, 512)
$g.Dispose()
$bmp.Save($env:JJ_AFFECTION_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`;

export async function renderAffectionCard(input: AffectionCardInput): Promise<boolean> {
  await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
  const payload = Buffer.from(JSON.stringify({
    userName: input.userName,
    personaName: input.personaName,
    scene: input.scene === 'group' ? '群聊' : '私聊',
    affinity: Math.max(0, Math.min(100, Math.round(input.affinity))),
    trust: Math.max(0, Math.min(100, Math.round(input.trust))),
    familiarity: Math.max(0, Math.min(100, Math.round(input.familiarity))),
    intimacy: Math.max(0, Math.min(100, Math.round(input.intimacy))),
    respect: Math.max(0, Math.min(100, Math.round(input.respect))),
    interactions: input.interactions,
    streakDays: input.streakDays,
    note: input.note ?? (input.firstMetAt ? '初见于 ' + input.firstMetAt.slice(0, 10) : ''),
  }), 'utf8').toString('base64');
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: { ...process.env, JJ_AFFECTION_JSON: payload, JJ_AFFECTION_PATH: input.outputPath },
    });
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } done(false); }, 15_000);
  });
}
