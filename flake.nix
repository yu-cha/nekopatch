{
  description = "ねこパッチ: 猫を置くパズルのゲーム";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = {nixpkgs, ...}: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = [
        pkgs.nodejs_24
        pkgs.just
        pkgs.openspec
      ];

      # git フックを設置する（方針は ~/git/knowledge/decisions/2026-10-17-184907-f92f-local-ci.md）。
      # worktree（.git がファイル）でも、元のリポジトリの .git/hooks に置く（判断 dc29）
      shellHook = ''
        if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
          hooks="$(git rev-parse --path-format=absolute --git-common-dir)/hooks"
          mkdir -p "$hooks"
          for name in pre-commit pre-push; do
            hook="$hooks/$name"
            if [ ! -e "$hook" ] || ! cmp -s "$root/scripts/git-hook.sh" "$hook"; then
              install -m 755 "$root/scripts/git-hook.sh" "$hook"
            fi
          done
        fi
      '';
    };
  };
}
