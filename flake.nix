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
            # Browsers for end-to-end tests. The npm package @playwright/test must be pinned to
            # the same version as this (check: nix eval --raw nixpkgs#playwright-driver.version).
            playwright-driver.browsers
          ];

          # Use Nix's browsers instead of letting Playwright download its own (which don't run
          # on NixOS).
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

          # Project-specific env vars (DATABASE_URL etc.) live in .envrc,
          # because direnv knows the project path reliably.
          shellHook = ''
            echo "tcg-virtual-library: node $(node --version), pnpm $(pnpm --version), $(postgres --version)"
          '';
        };
      });
}
