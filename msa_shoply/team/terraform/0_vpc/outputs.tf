output "vpc_id" {
  description = "VPC ID — 1~4번 폴더의 vpc_id 변수에 입력"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR — internal_cidr 변수에 사용"
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_id" {
  description = "퍼블릭 서브넷 ID — 1~4번 폴더의 subnet_id 변수에 입력"
  value       = aws_subnet.public.id
}

output "internet_gateway_id" {
  value = aws_internet_gateway.this.id
}

output "ec2_security_group_id" {
  description = "범용 EC2 SG ID"
  value       = aws_security_group.ec2.id
}

output "eip_allocation_id" {
  description = "EIP 할당 ID (EC2 연결 시 사용)"
  value       = aws_eip.this.allocation_id
}

output "eip_public_ip" {
  description = "EIP 공인 IP"
  value       = aws_eip.this.public_ip
}
