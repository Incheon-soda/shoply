variable "aws_region" {
  description = "AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "name" {
  description = "리소스 이름 prefix"
  type        = string
  default     = "shoply-prometheus-eks"
}

variable "vpc_id" {
  description = "EKS 측 VPC ID"
  type        = string
}

variable "subnet_id" {
  description = "EC2를 띄울 (퍼블릭) 서브넷 ID — EKS VPC"
  type        = string
}

variable "key_name" {
  description = "기존 EC2 키페어 이름 (SSH)"
  type        = string
}

variable "ami_id" {
  description = "직접 지정할 AMI. 비우면 Ubuntu 24.04 최신을 자동 조회"
  type        = string
  default     = ""
}

variable "instance_type" {
  description = "인스턴스 타입"
  type        = string
  default     = "t3.small"
}

variable "admin_cidr" {
  description = "SSH(22)·Prometheus(9090) 접근 관리자 IP"
  type        = string
}

variable "grafana_source_cidr" {
  description = "온프레미스 Grafana(모니터링 EC2)의 공인 IP/32 — 이 Prometheus(9090)를 데이터소스로 조회"
  type        = string
}

variable "associate_public_ip" {
  description = "퍼블릭 IP 부여 여부 (온프레 Grafana가 교차 VPC로 조회하려면 필요)"
  type        = bool
  default     = true
}

variable "root_volume_size" {
  description = "루트 EBS 크기(GB)"
  type        = number
  default     = 50
}

variable "tags" {
  description = "공통 태그"
  type        = map(string)
  default     = {}
}
