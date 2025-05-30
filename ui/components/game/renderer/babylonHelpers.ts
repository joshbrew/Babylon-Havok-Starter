import * as BABYLON from 'babylonjs';


export class SpriteFactory {
    private materialCache = new Map<string, BABYLON.StandardMaterial>()

    constructor(private scene: BABYLON.Scene) { }

    getMaterial(url: string): BABYLON.StandardMaterial {
        if (this.materialCache.has(url)) {
            return this.materialCache.get(url)!
        }
        const mat = new BABYLON.StandardMaterial(`mat_${url}`, this.scene)
        const tex = new BABYLON.Texture(url, this.scene)
        tex.hasAlpha = true
        mat.diffuseTexture = tex   // color & alpha
        mat.opacityTexture = tex
        mat.useAlphaFromDiffuseTexture = true
        mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND
        mat.disableLighting = false
        mat.backFaceCulling = false

        this.materialCache.set(url, mat)
        return mat
    }

    /** 
     * Creates a plane‐sprite, reusing its material if we've already loaded that URL 
     */
    public createSprite(
        name: string,
        url: string,
        size: number,
        role: string
    ): BABYLON.Mesh {
        const mesh = BABYLON.MeshBuilder.CreatePlane(name, { size }, this.scene)
        mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL
        mesh.rotation.x = Math.PI / 2
        mesh.rotation.y = Math.PI
        mesh.material = this.getMaterial(url)
        mesh.metadata = { role }
        return mesh
    }
}

