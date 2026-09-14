require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
new_arch_enabled = ENV["RCT_NEW_ARCH_ENABLED"] == "1"

Pod::Spec.new do |s|
  s.name = "WaypointMarkdownText"
  s.version = package["version"]
  s.summary = "Native selectable markdown renderer for Waypoint mobile."
  s.description = "Fabric-backed attributed text and markdown rendering primitives owned by Waypoint."
  s.homepage = "https://waypoint.invalid"
  s.license = { :type => "MIT", :file => "LICENSE" }
  s.author = { "Waypoint Contributors" => "maintainers@waypoint.invalid" }
  s.platforms = { :ios => min_ios_version_supported }
  s.source = { :path => "." }
  s.source_files = "ios/**/*.{h,m,mm,cpp}"

  install_modules_dependencies(s)

  if ENV["USE_FRAMEWORKS"] != nil && new_arch_enabled
    add_dependency(s, "React-FabricComponents", :additional_framework_paths => [
      "react/renderer/textlayoutmanager/platform/ios",
    ])
  end
end
