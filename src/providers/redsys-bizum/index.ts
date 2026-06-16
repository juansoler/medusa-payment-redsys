import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import RedsysBizumProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [RedsysBizumProviderService],
})
