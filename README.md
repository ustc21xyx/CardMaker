CardMaker：可部署在 Vercel 的「酒馆角色卡（SillyTavern chara_card_v3）」制卡助手。

- OpenAI 兼容接口：用户填写 `baseUrl + apiKey`，自动拉取 `/v1/models`
- 资料上传：多文件开关 + 拖动排序，按顺序完整拼接喂给大模型
- 导出：`JSON` 与「酒馆可导入 PNG」（写入 PNG `tEXt` chunk：`chara` + `ccv3`，base64(JSON)）

## 开发

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

## 使用（V1）

1) 打开 `API 设置`
   - 填 `baseUrl`（例如 `https://api.openai.com` 或你的兼容网关）
   - 填 `apiKey`
   - 点「拉取模型列表」，选择/填写模型
2) 在左侧输入「写卡目标」，可上传资料文件并拖动排序/开关
3) 在各 tab 中编辑字段，或点字段旁「AI 生成」；也可点右上「生成整卡」
4) 上传封面 PNG，点「导出 PNG」即可得到可导入 SillyTavern 的角色卡 PNG

## 部署到 Vercel

直接导入仓库到 Vercel 并部署即可（无需额外环境变量）。

## 注意

- `apiKey` 默认只保存在浏览器 `localStorage`，请求通过本站 `/api/*` 代理转发到你的 `baseUrl`
- 资料文件会按顺序“原文拼接”进提示词，注意模型上下文长度限制
