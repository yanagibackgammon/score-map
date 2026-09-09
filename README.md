# score-map

Backgammonの1ポジションについて、マッチスコア別の最善手を一覧表示するScore Mapです。

## Pages
- `index.html`：公開用Score Map
- `import.html`：ローカルXG/XGP読み込み用ページ

## Score matrix
行 = BLACK、列 = WHITE。

軸：
- Post Crawford
- Crawford
- 2away
- 3away
- 4away
- 5away

特殊セル：
- Post Crawford × Post Crawford = Unlimited
- Crawford × Crawford = DMP
- Post Crawford × Crawford = 対象外
- Crawford × Post Crawford = 対象外
- 有効セル = 34

## GitHub Pages 自動更新
`.github/workflows/pages.yml` を含めています。

`main` ブランチで公開対象ファイルに差分が入ると、GitHub Actionsが自動でPagesを更新します。

対象：
- `index.html`
- `import.html`
- ルート直下の `*.js`
- ルート直下の `*.css`
- `assets/**`
- `data/**`
- `.nojekyll`
- workflow自身

### 初回だけ必要な設定
GitHubリポジトリで **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。
以後は対象ファイルを `main` にcommit/pushするだけで、Pagesまで自動更新されます。

Actions画面の **Deploy Score Map to GitHub Pages** から `Run workflow` を押して手動再デプロイすることもできます。

## v02
- v01の全内容を収録
- GitHub Pages自動デプロイworkflowを追加
- 公開用成果物を `_site` に分離してデプロイ
- `.nojekyll` を追加
- `workflow_dispatch` による手動再デプロイに対応
- `concurrency` により古いデプロイをキャンセルし、最新commitを優先

## v01
- Position Drill-inspired monochrome board renderer
- 34-cell score table
- separate import page
- local XG/XGP file selection UI
- XG analysis parser is not yet connected
