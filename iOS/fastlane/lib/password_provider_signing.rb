# No credential values enter this helper. Scope registration to an existing host.
module PasswordProviderSigning
  CAPABILITY = "AUTOFILL_CREDENTIAL_PROVIDER".freeze
  def self.prepare(host_identifier, registry: Spaceship::ConnectAPI::BundleId)
    host = registry.find(host_identifier)
    raise "Existing Thingtime host App ID was not found; check PRODUCT_BUNDLE_IDENTIFIER before registration" unless host
    provider_identifier = "#{host_identifier}.password-provider"
    provider = registry.find(provider_identifier)
    provider ||= registry.create(name: "Thingtime Password Provider", platform: "IOS", identifier: provider_identifier)
    changed = []
    [[host_identifier, host], [provider_identifier, provider]].each do |identifier, bundle|
      next if bundle.get_capabilities.any? { |capability| capability.capability_type == CAPABILITY }
      bundle.create_capability(CAPABILITY)
      changed << identifier
    end
    changed
  end
end
