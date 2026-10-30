# Shared by the automatic release lane and its isolated tests.
def next_ios_release_number(versions)
  raise ArgumentError, 'Automatic releases require integer build numbers' if versions.empty? || versions.any? { |v| !v.to_s.match?(/\A[1-9][0-9]*\z/) }
  (versions.map(&:to_i).max + 1).to_s
end
