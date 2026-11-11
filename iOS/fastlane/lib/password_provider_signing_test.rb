require 'minitest/autorun'
require_relative 'password_provider_signing'

class PasswordProviderSigningTest < Minitest::Test
  Capability = Struct.new(:capability_type)
  class Bundle
    attr_reader :capabilities, :created
    attr_accessor :fail
    def initialize(capabilities = [])
      @capabilities = capabilities; @created = []
    end
    def get_capabilities; capabilities.map { |c| Capability.new(c) }; end
    def create_capability(value)
      raise 'API failure' if fail
      @created << value; @capabilities << value
    end
  end
  class Registry
    attr_reader :bundles, :created
    def initialize(bundles); @bundles = bundles; @created = []; end
    def find(id); bundles[id]; end
    def create(**values)
      @created << values; bundles[values[:identifier]] = Bundle.new
    end
  end
  def setup
    @host = Bundle.new(['PUSH_NOTIFICATIONS'])
    @registry = Registry.new('com.example.app' => @host)
  end
  def prepare; PasswordProviderSigning.prepare('com.example.app', registry: @registry); end
  def test_only_missing_provider_is_created_and_unrelated_capabilities_preserved
    assert_equal ['com.example.app', 'com.example.app.password-provider'], prepare
    assert_equal ['com.example.app.password-provider'], @registry.created.map { |v| v[:identifier] }
    assert_equal ['PUSH_NOTIFICATIONS', 'AUTOFILL_CREDENTIAL_PROVIDER'], @host.capabilities
    assert_equal [], prepare
    assert_equal 1, @registry.created.length
    assert_equal ['AUTOFILL_CREDENTIAL_PROVIDER'], @host.created
  end
  def test_existing_capabilities_are_not_duplicated
    @host.capabilities << 'AUTOFILL_CREDENTIAL_PROVIDER'
    @registry.bundles['com.example.app.password-provider'] = Bundle.new(['AUTOFILL_CREDENTIAL_PROVIDER'])
    assert_equal [], prepare
    assert_empty @registry.created
    assert_empty @host.created
  end
  def test_missing_host_cannot_create_main_identity_or_provider
    @registry.bundles.clear
    assert_raises(RuntimeError) { prepare }
    assert_empty @registry.created
  end
  def test_api_failure_is_not_hidden
    @host.fail = true
    assert_raises(RuntimeError) { prepare }
  end
end
