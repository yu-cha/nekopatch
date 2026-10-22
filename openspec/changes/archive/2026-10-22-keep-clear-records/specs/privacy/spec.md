# Spec Delta

## Purpose

クリアの記録をネットに送らない（ナンとの合意 2026-10-21 の 1）。記録は、スマホのブラウザの中だけに残す。

## ADDED Requirements

### Requirement: 記録をネットに送らない

ゲームのページは、ページの決まり（CSP。ページが何を読み込み、どこと通信してよいかをブラウザに伝える設定）で、通信（fetch など）とフォームの送信を禁止しなければならない（MUST）。読み込んでよいのは、このサイトのファイルと、文字の形（Google Fonts）だけにする。

#### Scenario: ページの決まりで通信を禁止している

- **GIVEN** ゲームのページ（`index.html`）
- **WHEN** ページの決まり（CSP）を読む
- **THEN** `connect-src 'none'` と `form-action 'none'` が入っている
- **AND** スクリプトは `'self'`（このサイトのファイル）だけが許されている
