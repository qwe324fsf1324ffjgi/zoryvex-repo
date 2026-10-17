output "site_bucket_name" {
  description = "The static-site bucket. Read by scripts/deploy.mjs, which uploads the built app after apply: Terraform owns the bucket and the distribution, never the bytes in them."
  value       = var.site_bucket_name
}

output "site_distribution_domain_name" {
  value = module.static_site.distribution_domain_name
}

output "api_endpoint" {
  value = module.api_gateway.api_endpoint
}

output "api_custom_domain_target" {
  description = "Feed into the Stage B Vercel DNS record table (api CNAME target) — see docs/DNS_RUNBOOK.md."
  value       = module.api_gateway.custom_domain_target
}

output "core_table_name" {
  value = module.core_table.table_name
}

output "alerts_topic_arn" {
  value = module.observability.alerts_topic_arn
}

# The base URL the browser bundle must talk to.
#
# apps/web decides at BUILD time whether it is the real application or a
# self-contained demo running on browser-local fakes: `isRealApiConfigured()`
# is just `Boolean(process.env.NEXT_PUBLIC_API_BASE_URL)`. A build without
# it produces a site that never contacts this API at all, and says so on the
# sign-in screen — "This demo build never sends real email".
#
# That is what shipped to production on 2026-09-11. The infrastructure was
# correct, the API was live and healthy, the site returned 200, and every
# page was the demo. Nothing failed, because nothing compares the built
# bundle against the environment it is being uploaded to.
#
# Exposed as an output rather than rebuilt from a variable in the deploy
# script so there is one answer per environment, and it comes from the same
# place Terraform used to configure the API's CORS and the Lambdas' own
# APP_ORIGIN.
output "api_public_base_url" {
  description = "Origin the browser bundle calls. The custom domain once it exists, the execute-api URL before that."
  value       = var.api_custom_domain_name != null && var.api_custom_domain_name != "" ? "https://${var.api_custom_domain_name}" : module.api_gateway.api_endpoint
}
