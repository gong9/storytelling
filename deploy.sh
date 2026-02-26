#!/bin/bash
set -e

SERVER="root@39.96.203.251"
REMOTE_DIR="/opt/storytelling"
IMAGE_TAR="storytelling-latest.tar"

echo "=== 构建镜像 (amd64) ==="
make build-amd64

echo "=== 导出镜像 ==="
docker save -o $IMAGE_TAR storytelling:latest-amd64

echo "=== 上传到服务器 ==="
ssh $SERVER "mkdir -p $REMOTE_DIR/out/audio $REMOTE_DIR/out/deep $REMOTE_DIR/.sessions && chmod -R 777 $REMOTE_DIR/out $REMOTE_DIR/.sessions"
scp $IMAGE_TAR .env docker-compose.prod.yml $SERVER:$REMOTE_DIR/

echo "=== 部署服务 ==="
ssh $SERVER "cd $REMOTE_DIR && \
  mv docker-compose.prod.yml docker-compose.yml && \
  docker load -i $IMAGE_TAR && \
  docker tag storytelling:latest-amd64 storytelling:latest && \
  docker-compose down 2>/dev/null || true && \
  docker-compose up -d && \
  rm -f $IMAGE_TAR && \
  docker-compose ps"

rm -f $IMAGE_TAR

echo ""
echo "=== 部署完成 ==="
echo "http://39.96.203.251:8001"
