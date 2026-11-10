require 'minitest/autorun'
require_relative 'release_version'
class ReleaseVersionTest < Minitest::Test
  def test_uses_largest_value_even_when_upload_order_differs
    assert_equal '46', next_ios_release_number(['31', '45', '44'])
    assert_equal '51', next_ios_release_number(['50', '31'])
  end
  def test_refuses_malformed_versions_instead_of_reusing_a_number
    ['', '1.2', 'abc', '0', '-1'].each { |bad| assert_raises(ArgumentError) { next_ios_release_number(['31', bad]) } }
  end
end
