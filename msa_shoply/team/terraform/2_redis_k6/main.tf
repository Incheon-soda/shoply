# Redis 7 (Docker) + k6 부하 생성기 EC2 — 한 세트로 관리

data "aws_ami" "ubuntu" {
  count       = var.ami_id == "" ? 1 : 0
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd*/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  ami_id = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu[0].id

  docker_install = <<-EOF
    #!/bin/bash
    exec > /var/log/user-data.log 2>&1
    set -e
    apt-get update -y
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
    usermod -aG docker ubuntu
  EOF

  redis_user_data = <<-EOF
    ${local.docker_install}
    mkdir -p /home/ubuntu/redis
    chown -R ubuntu:ubuntu /home/ubuntu/redis
  EOF

  k6_user_data = <<-EOF
    ${local.docker_install}
    mkdir -p /home/ubuntu/k6/scripts
    chown -R ubuntu:ubuntu /home/ubuntu/k6
  EOF
}

# ---------- Redis ----------
resource "aws_security_group" "redis" {
  name_prefix = "${var.name_prefix}-redis-sg-"
  description = "Shoply Redis EC2"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }
  ingress {
    description = "Redis (k8s 파드 접속)"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.internal_cidr]
  }
  ingress {
    description = "redis_exporter (Prometheus scrape)"
    from_port   = 9121
    to_port     = 9121
    protocol    = "tcp"
    cidr_blocks = [var.internal_cidr]
  }
  ingress {
    description = "node_exporter (Prometheus scrape)"
    from_port   = 9100
    to_port     = 9100
    protocol    = "tcp"
    cidr_blocks = [var.internal_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis-sg" })
}

resource "aws_instance" "redis" {
  ami                         = local.ami_id
  instance_type               = var.redis_instance_type
  subnet_id                   = var.subnet_id
  key_name                    = var.key_name
  vpc_security_group_ids      = [aws_security_group.redis.id]
  associate_public_ip_address = var.associate_public_ip
  user_data                   = local.redis_user_data

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis", Role = "redis" })
}

# ---------- k6 ----------
resource "aws_security_group" "k6" {
  name_prefix = "${var.name_prefix}-k6-sg-"
  description = "Shoply k6 부하 생성기"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }
  # k6는 부하를 '보내는' 쪽이라 인바운드 최소. 메트릭 remote_write는 아웃바운드.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-k6-sg" })
}

resource "aws_instance" "k6" {
  ami                         = local.ami_id
  instance_type               = var.k6_instance_type
  subnet_id                   = var.subnet_id
  key_name                    = var.key_name
  vpc_security_group_ids      = [aws_security_group.k6.id]
  associate_public_ip_address = var.associate_public_ip
  user_data                   = local.k6_user_data

  root_block_device {
    volume_size = var.root_volume_size
    volume_type = "gp3"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-k6", Role = "k6" })
}
