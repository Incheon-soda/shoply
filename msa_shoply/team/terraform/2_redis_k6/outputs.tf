output "redis_private_ip" {
  description = "Redis 사설 IP (k8s ConfigMap의 REDIS_HOST)"
  value       = aws_instance.redis.private_ip
}

output "redis_public_ip" {
  description = "Redis 공인 IP (SSH)"
  value       = aws_instance.redis.public_ip
}

output "redis_security_group_id" {
  value = aws_security_group.redis.id
}

output "k6_public_ip" {
  description = "k6 공인 IP (SSH, 부하 실행)"
  value       = aws_instance.k6.public_ip
}

output "k6_security_group_id" {
  value = aws_security_group.k6.id
}
