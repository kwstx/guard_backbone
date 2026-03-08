provider "aws" {
  region = "us-west-2"
}

resource "aws_db_instance" "production_db" {
  identifier        = "production-db"
  allocated_storage = 100
  storage_type      = "gp2"
  engine            = "postgres"
  engine_version    = "14.7"
  instance_class    = "db.t3.medium"
  username          = "admin"
  password          = "your_secure_password" # In production, use AWS Secrets Manager
  
  skip_final_snapshot = true

  lifecycle {
    prevent_destroy = true
  }
}
