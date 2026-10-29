# Release / 构建

## 本地构建

```powershell
npm ci
npm run build
npx electron-builder --win nsis
npx electron-builder --win msi
```

安装包输出到 `release/`，该目录默认不提交到 Git。

## GitHub Release

Release 附件需要单独上传安装包；Git 仓库只保存源码、文档、测试和 Git LFS 素材库。

## Git LFS

`dsh-pet-assets/**` 使用 Git LFS 保存。克隆后执行：

```powershell
git lfs install
git lfs pull
```
