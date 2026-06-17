output "instance_id" {
  value = aws_instance.this.id
}

output "private_ip" {
  description = "사설 IP (각 exporter의 Prometheus 타겟 등록 기준)"
  value       = aws_instance.this.private_ip
}

output "public_ip" {
  description = "공인 IP — Grafana(:3000)/Prometheus(:9090) 접속, EKS Prometheus 데이터소스 소스"
  value       = aws_instance.this.public_ip
}

output "security_group_id" {
  value = aws_security_group.this.id
}
