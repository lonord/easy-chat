APP_NAME := easy-chat
APP_VERSION := 2.0
BUILD_TIME := $(shell date "+%F %T %Z")

REGISTRY = lonord
DOCKER_BUILD = docker buildx build --platform=linux/amd64,linux/arm64

.PHONY: build docker

build:
	npm run build

docker:
	$(DOCKER_BUILD) -t $(REGISTRY)/$(APP_NAME):$(APP_VERSION) -t $(REGISTRY)/$(APP_NAME) . --push