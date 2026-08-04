.DEFAULT_GOAL := help
.PHONY: help doctor setup dev web build android check icons release clean

help: ## show this help
	@awk 'BEGIN {FS = ":.*?## "; printf "\n\033[1mUsage:\033[0m make \033[36m<target>\033[0m\n\n\033[1mTargets:\033[0m\n"} \
	     /^[a-z]+:.*?## / {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2} \
	     END {print ""}' $(MAKEFILE_LIST)

doctor: ## check required tools and project state
	@bash scripts/doctor.sh

setup: ## install dependencies (runs doctor first)
	@bash scripts/doctor.sh
	@pnpm install

dev: ## run the desktop app with hot reload
	@pnpm tauri dev

web: ## run only the UI in the browser on :1420
	@pnpm dev

build: ## build the desktop app bundles
	@pnpm tauri build

android: ## build the Android APK (MODE=debug|release|dev)
	@bash scripts/android.sh $(MODE)

check: ## type-check the frontend and the Rust backend
	@pnpm check
	@cd src-tauri && cargo check

icons: ## regenerate the app icon set from src-tauri/app-icon.png
	@bash scripts/icons.sh

release: ## bump the version, tag it, and let CI build every platform
	@bash scripts/release.sh $(VERSION)

clean: ## remove build output and caches
	@bash scripts/clean.sh
