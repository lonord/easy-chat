APP_NAME := easy-chat
APP_VERSION := 1.1
BUILD_TIME := $(shell date "+%F %T %Z")

REGISTRY = dkr.lonord.name
DOCKER_BUILD = docker buildx build --platform=linux/amd64,linux/arm64

.PHONY: build docker

build:
	npm run build

docker:
	$(DOCKER_BUILD) -t $(REGISTRY)/$(APP_NAME):$(APP_VERSION) -t $(REGISTRY)/$(APP_NAME) . --push