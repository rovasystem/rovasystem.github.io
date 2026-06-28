package sk.rova.arcore

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.ar.core.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

@CapacitorPlugin(
    name = "RovaArCore",
    permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")]
)
class RovaArCorePlugin : Plugin() {

    private var sessionManager: ArSessionManager? = null
    private val anchors = ConcurrentHashMap<String, Anchor>()
    private val planeIds = ConcurrentHashMap<Plane, String>()
    private val nextPlaneId = AtomicInteger(1)
    private var displayWidth = 1
    private var displayHeight = 1
    private var displayRotation = 0

    private fun floatArrayToJs(arr: FloatArray): JSArray {
        val out = JSArray()
        for (v in arr) out.put(v.toDouble())
        return out
    }

    private fun planeIdFor(plane: Plane): String {
        return planeIds.computeIfAbsent(plane) { "plane-${nextPlaneId.getAndIncrement()}" }
    }

    private fun syncDisplayGeometry() {
        sessionManager?.setDisplayGeometry(displayWidth, displayHeight, displayRotation)
    }

    @PluginMethod
    fun isSupported(call: PluginCall) {
        val supported = ArSessionManager.isSupported(activity)
        val ret = JSObject()
        ret.put("supported", supported)
        call.resolve(ret)
    }

    @PluginMethod
    fun startSession(call: PluginCall) {
        if (!hasCameraPermission()) {
            requestPermissionForAlias("camera", call, "cameraPermsCallback")
            return
        }
        try {
            if (sessionManager == null) sessionManager = ArSessionManager(activity)
            syncDisplayGeometry()
            sessionManager?.start()
            call.resolve()
        } catch (e: Exception) {
            call.reject("ARCore start failed: ${e.message}")
        }
    }

    @PermissionCallback
    private fun cameraPermsCallback(call: PluginCall) {
        if (hasCameraPermission()) startSession(call)
        else call.reject("Camera permission denied")
    }

    @PluginMethod
    fun stopSession(call: PluginCall) {
        sessionManager?.stop()
        anchors.clear()
        planeIds.clear()
        call.resolve()
    }

    @PluginMethod
    fun setDisplayGeometry(call: PluginCall) {
        val w = call.getInt("width") ?: 1
        val h = call.getInt("height") ?: 1
        val rot = call.getInt("rotation") ?: 0
        displayWidth = if (w > 0) w else 1
        displayHeight = if (h > 0) h else 1
        displayRotation = rot
        syncDisplayGeometry()
        call.resolve()
    }

    @PluginMethod
    fun getFrameData(call: PluginCall) {
        val frame = sessionManager?.update() ?: run {
            call.reject("Session not started")
            return
        }
        val camera = frame.camera
        val view = FloatArray(16)
        val proj = FloatArray(16)
        camera.getViewMatrix(view, 0)
        camera.getProjectionMatrix(proj, 0, 0.1f, 100f)
        val ret = JSObject()
        ret.put("viewMatrix", floatArrayToJs(view))
        ret.put("projectionMatrix", floatArrayToJs(proj))
        ret.put("pose", ArSessionManager.poseToJson(camera.pose))
        ret.put("displayWidth", displayWidth)
        ret.put("displayHeight", displayHeight)
        call.resolve(ret)
    }

    @PluginMethod
    fun getPlanes(call: PluginCall) {
        val session = sessionManager?.session ?: run {
            call.reject("Session not started")
            return
        }
        val frame = sessionManager?.update() ?: run {
            call.reject("No frame")
            return
        }
        val planes = JSArray()
        for (plane in session.getAllTrackables(Plane::class.java)) {
            if (plane.trackingState != TrackingState.TRACKING) continue
            val p = ArSessionManager.planeToJson(plane, planeIdFor(plane))
            planes.put(p)
        }
        val ret = JSObject()
        ret.put("planes", planes)
        call.resolve(ret)
    }

    @PluginMethod
    fun hitTest(call: PluginCall) {
        val xIn = call.getFloat("x") ?: 0.5f
        val yIn = call.getFloat("y") ?: 0.5f
        val frame = sessionManager?.update() ?: run {
            call.reject("Session not started")
            return
        }
        val px = if (xIn in 0f..1f && yIn in 0f..1f) xIn * displayWidth else xIn
        val py = if (xIn in 0f..1f && yIn in 0f..1f) yIn * displayHeight else yIn
        val hits = JSArray()
        val hitResults = frame.hitTest(px, py)
        for (hit in hitResults) {
            val trackable = hit.trackable
            if (trackable !is Plane) continue
            val obj = JSObject()
            obj.put("planeId", planeIdFor(trackable))
            obj.put("pose", ArSessionManager.poseToJson(hit.hitPose))
            obj.put("distance", hit.distance.toDouble())
            hits.put(obj)
        }
        val ret = JSObject()
        ret.put("hits", hits)
        call.resolve(ret)
    }

    @PluginMethod
    fun createAnchor(call: PluginCall) {
        val session = sessionManager?.session ?: run {
            call.reject("Session not started")
            return
        }
        val poseObj = call.getObject("pose") ?: run {
            call.reject("pose required")
            return
        }
        val pose = ArSessionManager.jsonToPose(poseObj)
        val anchor = session.createAnchor(pose)
        val id = UUID.randomUUID().toString()
        anchors[id] = anchor
        val ret = JSObject()
        ret.put("anchorId", id)
        call.resolve(ret)
    }

    @PluginMethod
    fun removeAnchor(call: PluginCall) {
        val id = call.getString("anchorId") ?: ""
        anchors.remove(id)?.detach()
        call.resolve()
    }

    @PluginMethod
    fun getAnchorPose(call: PluginCall) {
        val id = call.getString("anchorId") ?: ""
        val anchor = anchors[id] ?: run {
            call.reject("Anchor not found")
            return
        }
        val ret = JSObject()
        ret.put("pose", ArSessionManager.poseToJson(anchor.pose))
        call.resolve(ret)
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            activity, Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }
}
