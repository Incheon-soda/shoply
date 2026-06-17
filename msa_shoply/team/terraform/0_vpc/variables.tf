variable "aws_region" {
  description = "AWS 리전"
  type        = string
  default     = "ap-northeast-2"
}

variable "name" {
  description = "리소스 이름 prefix"
  type        = string
  default     = "shoply"
}

variable "vpc_cidr" {
  description = "VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "az" {
  description = "가용영역 (1개)"
  type        = string
  default     = "ap-northeast-2a"
}

variable "public_subnet_cidr" {
  description = "퍼블릭 서브넷 CIDR (1개)"
  type        = string
  default     = "10.0.1.0/24"
}

variable "admin_cidr" {
  description = "EC2 보안그룹 SSH(22) 허용 관리자 IP (예: 1.2.3.4/32)"
  type        = string
}

variable "tags" {
  description = "공통 태그"
  type        = map(string)
  default     = {}
}
