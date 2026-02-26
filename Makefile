# ============================================
# Storytelling Docker Build Makefile
# ============================================

# 镜像配置
IMAGE_NAME := storytelling
IMAGE_TAG := latest
REGISTRY := 

# 平台配置
PLATFORM_AMD64 := linux/amd64
PLATFORM_ARM64 := linux/arm64
PLATFORM_ALL := linux/amd64,linux/arm64

# Docker Buildx builder 名称
BUILDER_NAME := storytelling-builder

# 默认目标
.PHONY: help
help:
	@echo "============================================"
	@echo "  Storytelling Docker 构建命令"
	@echo "============================================"
	@echo ""
	@echo "构建命令:"
	@echo "  make build          - 构建当前平台镜像"
	@echo "  make build-amd64    - 构建 x86_64 镜像"
	@echo "  make build-arm64    - 构建 ARM64 镜像"
	@echo "  make build-all      - 构建多架构镜像 (amd64 + arm64)"
	@echo ""
	@echo "运行命令:"
	@echo "  make up             - 启动服务"
	@echo "  make down           - 停止服务"
	@echo "  make logs           - 查看日志"
	@echo "  make shell          - 进入容器 shell"
	@echo ""
	@echo "清理命令:"
	@echo "  make clean          - 清理构建缓存"
	@echo "  make prune          - 清理所有未使用的 Docker 资源"
	@echo ""
	@echo "推送命令:"
	@echo "  make push           - 推送镜像到 Registry"
	@echo "  make push-all       - 构建并推送多架构镜像"
	@echo ""
	@echo "部署命令:"
	@echo "  make deploy         - 部署到服务器 (39.96.203.251:8001)"
	@echo ""

# ============================================
# 构建命令
# ============================================

# 初始化 buildx builder
.PHONY: builder-init
builder-init:
	@docker buildx inspect $(BUILDER_NAME) > /dev/null 2>&1 || \
		docker buildx create --name $(BUILDER_NAME) --use --bootstrap

# 构建当前平台镜像
.PHONY: build
build:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

# 构建 AMD64 (x86_64) 镜像
.PHONY: build-amd64
build-amd64: builder-init
	docker buildx build \
		--platform $(PLATFORM_AMD64) \
		--tag $(IMAGE_NAME):$(IMAGE_TAG)-amd64 \
		--load \
		.

# 构建 ARM64 镜像
.PHONY: build-arm64
build-arm64: builder-init
	docker buildx build \
		--platform $(PLATFORM_ARM64) \
		--tag $(IMAGE_NAME):$(IMAGE_TAG)-arm64 \
		--load \
		.

# 构建多架构镜像 (本地)
.PHONY: build-all
build-all: builder-init
	docker buildx build \
		--platform $(PLATFORM_ALL) \
		--tag $(IMAGE_NAME):$(IMAGE_TAG) \
		.

# ============================================
# 运行命令
# ============================================

# 检查镜像是否存在
.PHONY: check-image
check-image:
	@docker image inspect $(IMAGE_NAME):$(IMAGE_TAG) > /dev/null 2>&1 || \
		(echo "错误: 镜像 $(IMAGE_NAME):$(IMAGE_TAG) 不存在，请先运行 'make build'" && exit 1)

# 启动服务
.PHONY: up
up: check-image
	docker-compose up -d

# 停止服务
.PHONY: down
down:
	docker-compose down

# 重启服务
.PHONY: restart
restart: down up

# 查看日志
.PHONY: logs
logs:
	docker-compose logs -f

# 进入容器 shell
.PHONY: shell
shell:
	docker-compose exec storytelling sh

# ============================================
# 清理命令
# ============================================

# 清理构建缓存
.PHONY: clean
clean:
	docker buildx prune -f
	docker image prune -f

# 清理所有未使用的 Docker 资源
.PHONY: prune
prune:
	docker system prune -af

# 删除 builder
.PHONY: builder-rm
builder-rm:
	docker buildx rm $(BUILDER_NAME) 2>/dev/null || true

# ============================================
# 推送命令
# ============================================

# 推送到 Registry
.PHONY: push
push:
ifdef REGISTRY
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(REGISTRY)/$(IMAGE_NAME):$(IMAGE_TAG)
	docker push $(REGISTRY)/$(IMAGE_NAME):$(IMAGE_TAG)
else
	@echo "错误: 请设置 REGISTRY 变量"
	@echo "示例: make push REGISTRY=your-registry.com"
endif

# 构建并推送多架构镜像
.PHONY: push-all
push-all: builder-init
ifdef REGISTRY
	docker buildx build \
		--platform $(PLATFORM_ALL) \
		--tag $(REGISTRY)/$(IMAGE_NAME):$(IMAGE_TAG) \
		--push \
		.
else
	@echo "错误: 请设置 REGISTRY 变量"
	@echo "示例: make push-all REGISTRY=your-registry.com"
endif

# ============================================
# 部署命令
# ============================================

# 部署到服务器
.PHONY: deploy
deploy:
	./deploy.sh
