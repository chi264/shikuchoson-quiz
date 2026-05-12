# 市町村クイズ PWA

スマホのホーム画面に保存して使える、市区町村当てクイズです。

## できること

- 都道府県別の市区町村名入力クイズ
- 漢字、ひらがな、カタカナ、半角カナ、末尾の市町村区省略に対応
- タイムアタック
- 読みクイズ
- 市区町村から都道府県を答えるクイズ
- 苦手リストと未回答ランキング
- 全国クリア率、スコアランキング
- 履歴の端末内保存、書き出し、読み込み
- PWA対応、オフラインキャッシュ対応

## ローカル確認

```powershell
node scripts/dev-server.js
```

表示されたURLをブラウザで開きます。

## CSV更新

元CSVを更新した場合は、次を実行してWebアプリ用JSONを作り直します。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/convert-data.ps1
```

## GitHub Pages

このフォルダの中身をリポジトリに入れ、GitHub Pagesの公開元をリポジトリルートにすると動きます。

iPhoneやAndroidでは、公開URLをブラウザで開き、共有メニューからホーム画面に追加してください。
