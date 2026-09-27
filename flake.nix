{
  description = "TCG Virtual Library - dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            pnpm
            postgresql_17
            jq
          ];

          # Project-specific env vars (DATABASE_URL etc.) live in .envrc,
          # because direnv knows the project path reliably.
          shellHook = ''
            echo "tcg-virtual-library: node $(node --version), pnpm $(pnpm --version), $(postgres --version)"
          '';
        };
      });
}
