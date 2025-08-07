import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GUI } from 'lil-gui';


// --- Module-scoped variables with TypeScript types ---
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGPURenderer;
let diamondMaterial: THREE.MeshPhysicalMaterial;

let diamond: THREE.Group | null = null;
const loader = new GLTFLoader(); // Create the loader once and reuse it

// Mouse interaction state for camera control
let isDragging = false;
let previousMousePosition = {
    x: 0,
    y: 0,
};

// New variables for smooth camera control
const spherical = new THREE.Spherical();
const targetSpherical = new THREE.Spherical();
const dampingFactor = 0.10; // Controls the amount of smoothing. Lower is smoother.

// --- Functions operating on module-scoped variables ---

/**
 * Creates a programmatic checkerboard texture using the Canvas API.
 * @returns {THREE.CanvasTexture} A texture containing the checkerboard pattern.
 */
function createCheckerboardTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Could not get 2D context from canvas');
    }

    context.fillStyle = '#ffffff'; // White
    context.fillRect(0, 0, 2, 2);
    context.fillStyle = '#999999'; // Gray
    context.fillRect(0, 0, 1, 1);
    context.fillRect(1, 1, 1, 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.NearestFilter; // Ensures sharp, non-blurry pixels
    texture.generateMipmaps = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

/**
 * Asynchronously loads a GLTF model, removes the old one, and adds the new one to the scene.
 * @param {string} modelUrl - The path to the GLTF model file.
 */
async function loadModel(modelUrl: string): Promise<void> {
    // Remove the current diamond model from the scene if it exists
    if (diamond) {
        scene.remove(diamond);
        // In a larger app, you might want to dispose of geometries and materials
        // to free up memory, but for this simple case, removal is sufficient.
    }

    try {
        const gltf = await loader.loadAsync(modelUrl);
        diamond = gltf.scene;

        // Apply the shared diamond material to all meshes in the loaded model
        diamond.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.material = diamondMaterial;
            }
        });

        scene.add(diamond);
    } catch (error) {
        console.error(`An error happened while loading the model: ${modelUrl}`, error);
    }
}

async function init(): Promise<void> {
    // --- Renderer Setup ---
    // renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer = new THREE.WebGPURenderer({ antialias: true });

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    // --- GUI Setup ---
    const gui = new GUI();

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 0, 0);

    // Initialize spherical coordinates from camera's initial position
    spherical.setFromVector3(camera.position);
    targetSpherical.copy(spherical);

    const rgbeLoader = new RGBELoader().setPath('hdri/');

    const hdrTexture = await rgbeLoader.loadAsync('photo_studio_loft_hall_1k.hdr');
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = hdrTexture; // Use the HDRI for the background for consistency
    scene.backgroundBlurriness = 0.8;
    scene.environment = hdrTexture;

    // --- Checkerboard Plane Setup ---
    const planeSize = 10;
    const planeGeometry = new THREE.PlaneGeometry(planeSize, planeSize);

    const checkerboardTexture = createCheckerboardTexture();
    const gridSize = 0.5;
    // Repeat the 2x2 texture pattern 5 times in each direction to create a 10x10 grid
    checkerboardTexture.repeat.set(planeSize / gridSize, planeSize / gridSize);

    const planeMaterial = new THREE.MeshPhysicalMaterial({
        map: checkerboardTexture,
        metalness: 0.25,       // Not metallic
        roughness: 0.65,     // Smooth, but not a perfect mirror to show some blur
        envMapIntensity: 1.0 // Allow the plane to fully reflect the new HDRI environment
    });

    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    scene.add(plane);

    // --- Material and Model Setup ---

    // Define the material first, so it can be used by the GUI and the loadModel function.
    diamondMaterial = new THREE.MeshPhysicalMaterial({
        roughness: 0.01,
        metalness: 0.01,
        
        transmission: 1.0, // Key property for transparency
        dispersion: 4.0,
        thickness: 1.5,
        ior: 2.7,        // Index of Refraction for diamond

        iridescence: 6.0,
        iridescenceIOR: 1.2,
        iridescenceThicknessRange: [100, 400],

        clearcoat: 1.0,
        clearcoatRoughness: 0.2,

        attenuationDistance: 1.,

        color: 0xffff00,   // Base color of the glass
        attenuationColor: 0xffff00,
    });

    // --- GUI Controls for Diamond Material ---
    const materialFolder = gui.addFolder('Diamond Material');
    materialFolder.addColor(diamondMaterial, 'color').name('宝石色').onChange(changeColor);

    materialFolder.add(diamondMaterial, 'roughness', 0, 1).name('表面粗糙度').domElement.title = '控制钻石表面的光滑程度，值越小越光滑。';
    materialFolder.add(diamondMaterial, 'metalness', 0, 1).name('表面金属度').domElement.title = '控制材质的金属性，对于钻石通常保持较低值。';
    
    materialFolder.add(diamondMaterial, 'transmission', 0, 1).name('透射度').domElement.title = '控制光线穿透材质的能力，1表示完全透射。';

    materialFolder.add(diamondMaterial, 'iridescence', 0, 10).name('虹彩强度').domElement.title = '材质表面的虹彩效应强度。';
    materialFolder.add(diamondMaterial, 'iridescenceIOR', 1.0, 2.33).name('虹彩色移强度');
    materialFolder.add(diamondMaterial.iridescenceThicknessRange, '1', 0, 1000).name('虹彩偏移').domElement.title = '控制虹彩薄膜的厚度，影响虹彩的颜色变化。';

    materialFolder.open();

    // --- GUI for Model Selection ---
    const modelSelection = {
        model: '/models/diamond.glb' // Default model
    };

    const modelFolder = gui.addFolder('选择模型');
    modelFolder.add(modelSelection, 'model', {
        '工程钻石': '/models/diamond.glb', // Assumes this file exists
        '测试钻石': '/models/dflat.glb',
    }).name('Select Model').onChange(loadModel);
    modelFolder.open();

    // Initial model load
    await loadModel(modelSelection.model);

    // Event Listeners
    window.addEventListener('resize', onWindowResize, false);
    renderer.domElement.addEventListener('mousedown', onMouseDown, false);
    renderer.domElement.addEventListener('mousemove', onMouseMove, false);
    renderer.domElement.addEventListener('mouseup', onMouseUp, false);
    renderer.domElement.addEventListener('mouseleave', onMouseUp, false); // Stop dragging if mouse leaves canvas
    renderer.domElement.addEventListener('wheel', onMouseWheel, false);

    // Start the animation loop
    renderer.setAnimationLoop(animate);
}

function animate(): void {
    // Apply damping to the spherical coordinates by interpolating towards the target
    spherical.theta = THREE.MathUtils.lerp(spherical.theta, targetSpherical.theta, dampingFactor);
    spherical.phi = THREE.MathUtils.lerp(spherical.phi, targetSpherical.phi, dampingFactor);

    // Interpolate radius for smooth zooming
    spherical.radius = THREE.MathUtils.lerp(spherical.radius, targetSpherical.radius, dampingFactor);

    // Update camera position from the smoothed spherical coordinates
    camera.position.setFromSpherical(spherical);

    // Always look at the center
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
}

function onWindowResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

}

function onMouseDown(event: MouseEvent): void {
    if (event.button === 0) { // Left mouse button
        isDragging = true;
        previousMousePosition.x = event.clientX;
        previousMousePosition.y = event.clientY;
    }
}

function onMouseMove(event: MouseEvent): void {
    if (!isDragging) return;

    const deltaX = event.clientX - previousMousePosition.x;
    const deltaY = event.clientY - previousMousePosition.y;
    previousMousePosition.x = event.clientX;
    previousMousePosition.y = event.clientY;

    // Define a sensitivity factor for rotation
    const rotationSpeed = 2; // Adjust sensitivity as needed

    // Update the target spherical coordinates based on mouse movement
    // We multiply by (Math.PI / window.innerHeight) to make the speed consistent across different screen sizes
    targetSpherical.theta -= deltaX * rotationSpeed * (Math.PI / window.innerHeight); // Horizontal rotation (azimuthal angle)
    targetSpherical.phi -= deltaY * rotationSpeed * (Math.PI / window.innerHeight);   // Vertical rotation (polar angle)

    // Define the clamping limits (in radians) to avoid going over the poles.
    const minPolarAngle = 0.05; // Just a bit from the top pole (Y-axis)
    const maxPolarAngle = Math.PI - 0.05; // Just a bit from the bottom pole

    // Clamp the vertical rotation
    targetSpherical.phi = Math.max(minPolarAngle, Math.min(maxPolarAngle, targetSpherical.phi));
}

function onMouseUp(): void {
    isDragging = false;
}

function onMouseWheel(event: WheelEvent): void {
    // 定义缩放灵敏度。可以根据需要调整。
    const zoomSpeed = 0.020;

    // 根据滚轮的 delta 值更新目标半径
    // 正的 deltaY 表示向下滚动（缩小），负的表示向上滚动（放大）
    targetSpherical.radius += event.deltaY * zoomSpeed;

    // 定义半径的限制范围，防止缩放得太近或太远
    const minRadius = 1;
    const maxRadius = 20;

    // 限制半径
    targetSpherical.radius = Math.max(minRadius, Math.min(maxRadius, targetSpherical.radius));
}

function changeColor() {
    diamondMaterial.attenuationColor = diamondMaterial.color;
}

// --- Main Execution ---

/**
 * Main entry point for the application.
 * Using an async function allows us to use top-level await for initialization.
 */
async function main() {
    try {
        await init();
    } catch (err) {
        console.error("Failed to initialize the application:", err);
    }
}

main();
