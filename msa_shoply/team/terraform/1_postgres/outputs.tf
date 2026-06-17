output "instance_id" {
  description = "EC2 인스턴스 ID"
  value       = aws_instance.this.id
}

output "private_ip" {
  description = "사설 IP (k8s ConfigMap의 POSTGRES_HOST에 사용)"
  value       = aws_instance.this.private_ip
}

output "public_ip" {
  description = "공인 IP (SSH)"
  value       = aws_instance.this.public_ip
}

output "security_group_id" {
  description = "보안 그룹 ID"
  value       = aws_security_group.this.id
}
