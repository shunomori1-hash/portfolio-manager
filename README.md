# Portfolio Manager

日本株ポートフォリオ管理アプリ

## 起動方法

```bash
npm install
npm run dev:all
```

- フロントエンド: http://localhost:5174/ （ポート固定・strictPort）
- APIサーバー: http://localhost:3001

> `vite.config.ts` で `port: 5174, strictPort: true` を設定しているため、5174 が使用中の場合は別ポートへ逃げずエラーになります。

## コマンド

| コマンド | 説明 |
|---|---|
| `npm run dev:all` | フロント + APIサーバー同時起動 |
| `npm run dev` | フロントのみ起動 |
| `npm run dev:api` | APIサーバーのみ起動 |
| `npm run build` | 本番ビルド |

## データ

- `data/portfolio.json` — ポートフォリオデータ
- `data/backups/` — 保存前の自動バックアップ（最新20件保持）

## 機能

- 日本株PF一覧テーブル（33列）
- 保有金額・割合・上値余地などの自動計算
- 「株価一括更新」ボタン（Yahoo Finance経由）
- テーブル上でのインライン編集
- 保存ボタンで `data/portfolio.json` に永続化
- 保存前に自動バックアップ
- サマリー欄（買いポジ・先物・配当・タグ別）

## トラブルシューティング

### アプリが開かない / ブラウザでエラーが出る

デスクトップの `PF管理起動.bat` をダブルクリックして再起動してください。  
起動前にポート 5174・3001 の既存プロセスを自動で停止してから起動します。

---

### Port 5174 is already in use

前回の Vite プロセスが残っています。

**方法1（推奨）**: `PF管理起動.bat` を再実行（ポートを自動で開放）

**方法2（手動）**:
```batch
taskkill /F /IM node.exe
cd C:\Users\shuno\portfolio-manager
npm.cmd run dev:all
```

---

### 「APIサーバーが起動していません。PF管理起動.bat を再実行してください。」

フロントは起動しているが API サーバー（ポート 3001）が落ちています。

**方法1（推奨）**: `PF管理起動.bat` を再実行

**方法2（手動）**:
```batch
taskkill /F /IM node.exe
cd C:\Users\shuno\portfolio-manager
npm.cmd run dev:all
```

---

### 手動でポートを開放する方法

```batch
REM ポート 5174 を使っているプロセスを停止
for /f "tokens=5" %p in ('netstat -aon ^| findstr ":5174 "') do taskkill /F /PID %p

REM ポート 3001 を使っているプロセスを停止
for /f "tokens=5" %p in ('netstat -aon ^| findstr ":3001 "') do taskkill /F /PID %p

REM 再起動
cd C:\Users\shuno\portfolio-manager
npm.cmd run dev:all
```
