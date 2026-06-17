variable "aws_region" {
  description = "AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "name_prefix" {
  description = "리소스 이름 prefix"
  type        = string
  default     = "shoply"
}

variable "vpc_id" {
  description = "기존 VPC ID"
  type        = string
}

variable "subnet_id" {
  description = "EC2를 띄울 (퍼블릭) 서브넷 ID"
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

variable "redis_instance_type" {
  description = "Redis 인스턴스 타입"
  type        = string
  default     = "t3.small"
}

variable "k6_instance_type" {
  description = "k6 인스턴스 타입"
  type        = string
  default     = "t3.medium"
}

variable "admin_cidr" {
  description = "SSH(22) 허용 관리자 IP (예: 1.2.3.4/32)"
  type        = string
}

variable "internal_cidr" {
  description = "내부 통신 허용 대역 — k8s 호스트의 Redis 접속(6379), 모니터링 scrape(9121/9100). 보통 VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "associate_public_ip" {
  description = "퍼블릭 IP 부여 여부"
  type        = bool
  default     = true
}

variable "root_volume_size" {
  description = "루트 EBS 크기(GB)"
  type        = number
  default     = 30
}

variable "tags" {
  description = "공통 태그"
  type        = map(string)
  default     = {}
}
