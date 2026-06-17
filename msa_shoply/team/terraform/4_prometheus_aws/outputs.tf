output "instance_id" {
  value = aws_instance.this.id
}

output "private_ip" {
  description = "EKS VPC 내 사설 IP (워커 scrape 기준)"
  value       = aws_instance.this.private_ip
}

output "public_ip" {
  description = "공인 IP — 온프레미스 Grafana 데이터소스 URL (http://<public_ip>:9090)"
  value       = aws_instance.this.public_ip
}

output "security_group_id" {
  value = aws_security_group.this.id
}
